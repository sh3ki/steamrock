const express = require('express');
const Project = require('../models/Project');
const Property = require('../models/Property');
const SiteSettings = require('../models/SiteSettings');

const router = express.Router();

const DEPLOYED_SITE_URL = process.env.PUBLIC_SITE_URL || 'https://www.streamrockrealty.com';
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

const DOMAIN_KEYWORDS = [
  'streamrock',
  'realty',
  'project',
  'projects',
  'property',
  'properties',
  'unit',
  'units',
  'lot',
  'condo',
  'house',
  'commercial',
  'residential',
  'price',
  'budget',
  'amenity',
  'amenities',
  'location',
  'developer',
  'contractor',
  'category',
  'book',
  'booking',
  'schedule',
  'meeting',
  'visit',
  'site visit',
  'inquiry',
  'contact',
  'faq',
  'beachtowns',
  'beach towns',
  'parks',
  'shores',
  'peaks'
];

const OFF_TOPIC_KEYWORDS = [
  'joke',
  'movie',
  'song',
  'lyrics',
  'recipe',
  'politics',
  'election',
  'crypto',
  'bitcoin',
  'sports',
  'nba',
  'nfl',
  'celebrity',
  'horoscope',
  'astrology',
  'homework',
  'exam'
];

const FOLLOW_UP_KEYWORDS = [
  'yes',
  'yeah',
  'yep',
  'sure',
  'ok',
  'okay',
  'tell me more',
  'more details',
  'what about',
  'how about',
  'next',
  'go on'
];

const DEFAULT_FAQS = [
  {
    id: 'faq-project-categories',
    question: 'What project categories can I browse?',
    quickPrompt: 'Show me all available project categories and what each one offers.',
    answer: 'You can explore Parks, Beach Towns, Shores, and Peaks at https://www.streamrockrealty.com/projects'
  },
  {
    id: 'faq-featured-projects',
    question: 'What are your featured projects?',
    quickPrompt: 'List your featured projects with short highlights and links.',
    answer: 'I can list featured projects and direct links so you can open each one quickly.'
  },
  {
    id: 'faq-budget-help',
    question: 'Can you recommend projects based on my budget?',
    quickPrompt: 'Recommend projects for my budget and preferred location.',
    answer: 'Yes. Share your budget, preferred location, and property type, and I will recommend the best-fit options.'
  },
  {
    id: 'faq-schedule-meeting',
    question: 'How do I schedule a meeting or site visit?',
    quickPrompt: 'Help me schedule a meeting for full details and clarification.',
    answer: 'You can book through https://www.streamrockrealty.com/contact and I can guide you step-by-step.'
  }
];

const safeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatNumber = (value) => {
  if (!Number.isFinite(value)) return null;
  return new Intl.NumberFormat('en-PH').format(value);
};

const formatPriceRange = (priceRange = {}) => {
  const min = safeNumber(priceRange.min);
  const max = safeNumber(priceRange.max);
  const currency = priceRange.currency || 'PHP';

  if (min == null && max == null) return null;
  if (min != null && max != null) return `${currency} ${formatNumber(min)} - ${formatNumber(max)}`;
  if (min != null) return `${currency} ${formatNumber(min)} and up`;
  return `Up to ${currency} ${formatNumber(max)}`;
};

const toAbsoluteUrl = (pathOrUrl) => {
  if (!pathOrUrl || typeof pathOrUrl !== 'string') return '';
  const value = pathOrUrl.trim();
  if (!value) return '';

  if (/^https?:\/\//i.test(value)) return value;
  if (!value.startsWith('/')) return `${DEPLOYED_SITE_URL}/${value}`;
  return `${DEPLOYED_SITE_URL}${value}`;
};

const collectProjectNames = (projects = []) => projects.map((project) => project.name.toLowerCase());

const collectContextKeywords = (context = {}) => {
  const keywords = new Set();

  (context.projects || []).forEach((project) => {
    [project.name, project.category, project.propertyType, project.location, project.contractor]
      .filter(Boolean)
      .forEach((value) => keywords.add(String(value).toLowerCase()));
  });

  (context.properties || []).forEach((property) => {
    [property.name, property.category, property.propertyType, property.location, property.status]
      .filter(Boolean)
      .forEach((value) => keywords.add(String(value).toLowerCase()));
  });

  return [...keywords];
};

const isSystemRelatedMessage = (userMessage, projectNames = [], contextKeywords = []) => {
  if (!userMessage || typeof userMessage !== 'string') return false;

  const text = userMessage.toLowerCase();

  if (/^(hi|hello|hey|good morning|good afternoon|good evening)\b/.test(text)) {
    return true;
  }

  if (DOMAIN_KEYWORDS.some((keyword) => text.includes(keyword))) {
    return true;
  }

  if (projectNames.some((projectName) => text.includes(projectName))) {
    return true;
  }

  if (contextKeywords.some((keyword) => keyword && text.includes(keyword))) {
    return true;
  }

  if (FOLLOW_UP_KEYWORDS.some((keyword) => text.includes(keyword))) {
    return true;
  }

  if (OFF_TOPIC_KEYWORDS.some((keyword) => text.includes(keyword))) {
    return false;
  }

  return false;
};

const ensureSchedulePrompt = (replyText) => {
  const response = (replyText || '').trim();
  if (!response) {
    return 'I can help you with Streamrock system information. Would you like to schedule a meeting for a full in-depth clarification and details of units and projects?';
  }

  if (/(schedule|meeting|site visit|consultation)/i.test(response)) {
    return response;
  }

  return `${response}\n\nWould you like to schedule a meeting for a full in-depth clarification and details of the units and projects? You may also use https://www.streamrockrealty.com/contact.`;
};

const buildAssistantContext = async () => {
  const [settings, projects, properties] = await Promise.all([
    SiteSettings.findOne({ key: 'main' }).lean(),
    Project.find({ status: 'Published' })
      .populate('contractor', 'name')
      .populate('location', 'city province barangay')
      .sort({ featured: -1, order: 1, createdAt: -1 })
      .lean(),
    Property.find({ status: { $in: ['Available', 'Reserved'] } })
      .sort({ featured: -1, createdAt: -1 })
      .lean()
  ]);

  const projectsSummary = projects.map((project) => ({
    id: String(project._id),
    name: project.name,
    slug: project.slug,
    category: project.category,
    propertyType: project.propertyType,
    location: [project.location?.city, project.location?.province].filter(Boolean).join(', '),
    contractor: project.contractor?.name || '',
    shortDescription: project.shortDescription || '',
    priceRange: formatPriceRange(project.priceRange),
    featured: Boolean(project.featured),
    link: toAbsoluteUrl(`/projects/${project.slug}`)
  }));

  const propertiesSummary = properties.map((property) => ({
    id: String(property._id),
    name: property.name,
    category: property.category,
    propertyType: property.propertyType,
    location: property.location,
    price: Number.isFinite(Number(property.price)) ? `PHP ${formatNumber(Number(property.price))}` : null,
    status: property.status,
    bedrooms: property.bedrooms ?? null,
    bathrooms: property.bathrooms ?? null,
    lotArea: property.lotArea ?? null,
    floorArea: property.floorArea ?? null,
    featured: Boolean(property.featured),
    link: toAbsoluteUrl('/contact')
  }));

  const navLinks = (settings?.navLinks || [])
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((navItem) => ({
      name: navItem.name,
      path: toAbsoluteUrl(navItem.path),
      dropdownItems: (navItem.dropdownItems || []).map((dropdownItem) => ({
        name: dropdownItem.name,
        path: toAbsoluteUrl(dropdownItem.path)
      }))
    }));

  const context = {
    generatedAt: new Date().toISOString(),
    site: {
      name: settings?.siteName || 'Streamrock Realty',
      tagline: settings?.tagline || 'Your Trusted Real Estate Partner',
      contact: {
        phone: settings?.contact?.phone || '',
        email: settings?.contact?.email || '',
        address: settings?.contact?.address || ''
      },
      links: {
        home: toAbsoluteUrl('/'),
        projects: toAbsoluteUrl('/projects'),
        contact: toAbsoluteUrl('/contact')
      }
    },
    counts: {
      publishedProjects: projectsSummary.length,
      activeProperties: propertiesSummary.length
    },
    navigation: navLinks,
    projects: projectsSummary,
    properties: propertiesSummary,
    faqs: DEFAULT_FAQS,
    assistantRules: {
      scope: 'Answer only with Streamrock system-related information and data in this context.',
      recommendationMode: 'Recommend projects/properties based on user budget, location, and property type.',
      meetingCTA: 'Always ask if user wants to schedule a meeting for full in-depth clarification.'
    }
  };

  return context;
};

const buildSystemPrompt = (context) => {
  const contextJson = JSON.stringify(context);

  return [
    'You are Rocky AI, a friendly but professional assistant for Streamrock Realty.',
    'Your strict scope: only answer questions that are directly related to Streamrock system data and website information.',
    'If a user asks for anything unrelated, politely decline and redirect them to Streamrock projects/properties/contact topics.',
    'Use only facts from the provided live context. Do not invent missing details.',
    'When user intent is about finding a unit/project, be suggestive and recommend best-fit options based on budget, location, and property type.',
    'Whenever possible, include relevant links using full URLs under https://www.streamrockrealty.com so users can click and navigate quickly.',
    'Always end every response by asking if they want to schedule a meeting for a full in-depth clarification and details of units/projects.',
    'Keep tone concise, warm, and professional.',
    `Live context JSON: ${contextJson}`
  ].join(' ');
};

const sanitizeMessages = (messages = []) => {
  if (!Array.isArray(messages)) return [];

  return messages
    .filter((item) => item && typeof item.content === 'string')
    .map((item) => ({
      role: item.role === 'assistant' ? 'assistant' : 'user',
      content: item.content.trim().slice(0, 2500)
    }))
    .filter((item) => item.content.length > 0)
    .slice(-10);
};

// @route   GET /api/assistant/context
// @desc    Generate live AI knowledge context from system data
// @access  Public
router.get('/context', async (req, res) => {
  try {
    const context = await buildAssistantContext();
    res.json(context);
  } catch (error) {
    res.status(500).json({ message: 'Failed to build assistant context', error: error.message });
  }
});

// @route   POST /api/assistant/chat
// @desc    Chat with Rocky AI (Groq) using live system context
// @access  Public
router.post('/chat', async (req, res) => {
  try {
    const context = await buildAssistantContext();
    const messages = sanitizeMessages(req.body?.messages || []);
    const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user')?.content || '';
    const projectNames = collectProjectNames(context.projects || []);
    const contextKeywords = collectContextKeywords(context);

    if (!lastUserMessage) {
      return res.status(400).json({ message: 'A user message is required.' });
    }

    if (!isSystemRelatedMessage(lastUserMessage, projectNames, contextKeywords)) {
      const offTopicReply = [
        'I can only assist with Streamrock system information such as projects, units, prices, locations, and contact details.',
        `You can explore available options at ${toAbsoluteUrl('/projects')} or reach our team at ${toAbsoluteUrl('/contact')}.`,
        'Would you like to schedule a meeting for a full in-depth clarification and details of the units and projects?'
      ].join(' ');

      return res.json({
        reply: offTopicReply,
        contextGeneratedAt: context.generatedAt,
        restricted: true
      });
    }

    const groqApiKey = process.env.GROQ_API_KEY;
    if (!groqApiKey) {
      return res.status(500).json({
        message: 'GROQ_API_KEY is not configured on the server.'
      });
    }

    const groqResponse = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${groqApiKey}`
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.2,
        max_tokens: 700,
        messages: [
          { role: 'system', content: buildSystemPrompt(context) },
          ...messages
        ]
      })
    });

    const responseData = await groqResponse.json();

    if (!groqResponse.ok) {
      return res.status(groqResponse.status).json({
        message: responseData?.error?.message || 'Failed to get response from Groq.'
      });
    }

    const reply = responseData?.choices?.[0]?.message?.content || '';

    res.json({
      reply: ensureSchedulePrompt(reply),
      contextGeneratedAt: context.generatedAt,
      model: GROQ_MODEL
    });
  } catch (error) {
    res.status(500).json({
      message: 'Rocky AI encountered an error.',
      error: error.message
    });
  }
});

module.exports = router;