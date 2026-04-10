const SECTION_TYPES = ['intro', 'about', 'explore', 'features', 'gallery', 'custom'];
const COMPONENT_TYPES = ['label', 'title', 'subtitle', 'longText', 'bullets', 'checkedFeatures', 'images'];

const createId = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;

const asString = (value) => (typeof value === 'string' ? value.trim() : '');

const toNumber = (value) => {
  if (value === '' || value === null || value === undefined) {
    return undefined;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : undefined;
};

const normalizeImage = (image, index) => {
  if (typeof image === 'string') {
    const url = asString(image);

    if (!url) {
      return null;
    }

    return {
      id: createId('image'),
      url,
      caption: '',
      alt: '',
      order: index
    };
  }

  if (!image || typeof image !== 'object') {
    return null;
  }

  const url = asString(image.url);

  if (!url) {
    return null;
  }

  return {
    id: asString(image.id) || createId('image'),
    url,
    caption: asString(image.caption),
    alt: asString(image.alt),
    order: typeof image.order === 'number' ? image.order : index
  };
};

const normalizeTextItems = (items) => {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => asString(typeof item === 'string' ? item : item?.title || item?.content || item?.value))
    .filter(Boolean);
};

const normalizeComponent = (component) => {
  if (!component || typeof component !== 'object') {
    return null;
  }

  const type = COMPONENT_TYPES.includes(component.type) ? component.type : 'title';

  if (type === 'images') {
    const images = (Array.isArray(component.images) ? component.images : [])
      .map(normalizeImage)
      .filter(Boolean)
      .map((image, imageIndex) => ({ ...image, order: imageIndex }));

    return {
      id: asString(component.id) || createId('component'),
      type,
      images,
      items: [],
      content: ''
    };
  }

  if (type === 'bullets' || type === 'checkedFeatures') {
    return {
      id: asString(component.id) || createId('component'),
      type,
      items: normalizeTextItems(component.items),
      images: [],
      content: ''
    };
  }

  return {
    id: asString(component.id) || createId('component'),
    type,
    content: asString(component.content ?? component.value ?? component.text),
    items: [],
    images: []
  };
};

const buildLegacyComponents = (section) => {
  const components = [];

  if (section.label) {
    components.push({ type: 'label', content: section.label });
  }

  if (section.title) {
    components.push({ type: 'title', content: section.title });
  }

  if (section.subtitle) {
    components.push({ type: 'subtitle', content: section.subtitle });
  }

  if (section.description) {
    components.push({ type: 'longText', content: section.description });
  }

  if (Array.isArray(section.features) && section.features.length > 0) {
    components.push({
      type: section.type === 'features' ? 'checkedFeatures' : 'bullets',
      items: section.features
    });
  }

  if (Array.isArray(section.images) && section.images.length > 0) {
    components.push({
      type: 'images',
      images: section.images
    });
  }

  return components.map(normalizeComponent).filter(Boolean);
};

const deriveSectionSummary = (sectionType, components) => {
  const findFirstContent = (type) => components.find((component) => component.type === type)?.content || '';
  const findList = (type) => components.find((component) => component.type === type)?.items || [];
  const findImages = () => components.find((component) => component.type === 'images')?.images || [];

  const bullets = findList('bullets');
  const checkedFeatures = findList('checkedFeatures');
  const images = findImages();

  return {
    label: findFirstContent('label'),
    title: findFirstContent('title'),
    subtitle: findFirstContent('subtitle'),
    description: findFirstContent('longText') || findFirstContent('subtitle'),
    features: sectionType === 'features' || checkedFeatures.length > 0 ? checkedFeatures : bullets,
    images: images.map((image) => image.url)
  };
};

const normalizeSection = (section, index) => {
  if (!section || typeof section !== 'object') {
    return null;
  }

  const sectionType = SECTION_TYPES.includes(section.sectionType)
    ? section.sectionType
    : SECTION_TYPES.includes(section.type)
      ? section.type
      : 'custom';

  const components = (Array.isArray(section.components) && section.components.length > 0
    ? section.components.map(normalizeComponent)
    : buildLegacyComponents(section))
    .filter(Boolean);

  const safeComponents = components.length > 0
    ? components
    : [normalizeComponent({ type: 'title', content: '' })];

  const summary = deriveSectionSummary(sectionType, safeComponents);

  return {
    id: asString(section.id) || createId('section'),
    order: typeof section.order === 'number' ? section.order : index,
    type: sectionType,
    sectionType,
    label: summary.label,
    title: summary.title,
    subtitle: summary.subtitle,
    description: summary.description,
    images: summary.images,
    features: summary.features,
    backgroundColor: asString(section.backgroundColor) || '#ffffff',
    textColor: asString(section.textColor) || '#1a202c',
    components: safeComponents
  };
};

const deriveGallery = (sections) => sections
  .filter((section) => section.sectionType === 'gallery')
  .flatMap((section) => section.components)
  .filter((component) => component.type === 'images')
  .flatMap((component) => component.images)
  .map((image, index) => ({
    url: image.url,
    caption: image.caption,
    order: index
  }));

const deriveFeatures = (sections) => sections
  .filter((section) => section.sectionType === 'features')
  .flatMap((section) => section.components)
  .filter((component) => component.type === 'checkedFeatures')
  .flatMap((component) => component.items)
  .map((item) => ({
    title: item,
    description: ''
  }));

const normalizeProjectPayload = (payload = {}) => {
  const name = asString(payload.name);
  const hero = {
    image: asString(payload.hero?.image),
    video: asString(payload.hero?.video),
    title: asString(payload.hero?.title) || name,
    subtitle: asString(payload.hero?.subtitle)
  };

  const sections = (Array.isArray(payload.sections) ? payload.sections : [])
    .map(normalizeSection)
    .filter(Boolean)
    .sort((left, right) => left.order - right.order)
    .map((section, index) => ({ ...section, order: index }));

  return {
    ...payload,
    name,
    shortDescription: asString(payload.shortDescription),
    youtubeUrl: asString(payload.youtubeUrl),
    category: asString(payload.category),
    contractor: payload.contractor,
    location: payload.location,
    propertyType: asString(payload.propertyType),
    lotSizeRange: {
      min: toNumber(payload.lotSizeRange?.min),
      max: toNumber(payload.lotSizeRange?.max),
      unit: asString(payload.lotSizeRange?.unit) || 'sqm'
    },
    totalArea: {
      value: toNumber(payload.totalArea?.value),
      unit: asString(payload.totalArea?.unit) || 'Hectares'
    },
    priceRange: {
      min: toNumber(payload.priceRange?.min),
      max: toNumber(payload.priceRange?.max),
      currency: asString(payload.priceRange?.currency) || 'PHP'
    },
    featuredProperty: {
      propertyType: asString(payload.featuredProperty?.propertyType) || 'Lot',
      title: asString(payload.featuredProperty?.title),
      description: asString(payload.featuredProperty?.description),
      location: asString(payload.featuredProperty?.location),
      price: toNumber(payload.featuredProperty?.price),
      lotArea: toNumber(payload.featuredProperty?.lotArea),
      floorArea: toNumber(payload.featuredProperty?.floorArea),
      unitSizeArea: toNumber(payload.featuredProperty?.unitSizeArea),
      unitSizeRange: asString(payload.featuredProperty?.unitSizeRange)
    },
    hero,
    cardImage: asString(payload.cardImage) || hero.image,
    sections,
    gallery: deriveGallery(sections),
    features: deriveFeatures(sections),
    status: asString(payload.status) || 'Draft',
    featured: Boolean(payload.featured),
    order: toNumber(payload.order) ?? 0
  };
};

module.exports = {
  normalizeProjectPayload
};