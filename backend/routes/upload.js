const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { protect, adminOnly } = require('../middleware/auth');
const MediaFile = require('../models/MediaFile');
const Project = require('../models/Project');
const Blog = require('../models/Blog');
const {
  buildCloudinaryFolder,
  cloudinary,
  uploadBufferToCloudinary
} = require('../utils/cloudinary');

const storage = multer.memoryStorage();

// File filter
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp|mp4|mov|avi/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (extname && mimetype) {
    return cb(null, true);
  }
  cb(new Error('Only images and videos are allowed'));
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

const uploadSingleToCloudinary = async (req, file) => {
  const type = req.query.type || 'general';
  const category = req.query.category || '';
  const entity = req.query.entity || '';
  const field = req.query.field || '';
  const folder = buildCloudinaryFolder({ type, category, entity, field });

  const uploadResult = await uploadBufferToCloudinary(file.buffer, {
    folder,
    resourceType: 'auto'
  });

  return {
    filename: file.originalname,
    url: uploadResult.secure_url,
    publicId: uploadResult.public_id,
    resourceType: uploadResult.resource_type || 'image',
    folder,
    size: file.size,
    mimetype: file.mimetype,
    type,
    category,
    entity,
    field
  };
};

// @route   GET /api/upload
// @desc    List all uploaded files
// @access  Private/Admin
router.get('/', protect, adminOnly, async (req, res) => {
  try {
    const filter = {};
    if (req.query.type) filter.type = req.query.type;
    if (req.query.category) filter.category = req.query.category;
    if (req.query.entity) {
      filter.entity = { $regex: req.query.entity, $options: 'i' };
    }
    const files = await MediaFile.find(filter).sort({ createdAt: -1 });
    res.json(files);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST /api/upload
// @desc    Upload single file
// @access  Private/Admin
router.post('/', protect, adminOnly, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const uploadedFile = await uploadSingleToCloudinary(req, req.file);

    const mediaFile = await MediaFile.create({
      ...uploadedFile,
      uploadedBy: req.admin._id
    });

    res.json({
      message: 'File uploaded successfully',
      _id: mediaFile._id,
      filename: mediaFile.filename,
      url: mediaFile.url,
      publicId: mediaFile.publicId,
      size: mediaFile.size,
      mimetype: mediaFile.mimetype,
      type: mediaFile.type,
      folder: mediaFile.folder
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST /api/upload/multiple
// @desc    Upload multiple files
// @access  Private/Admin
router.post('/multiple', protect, adminOnly, upload.array('files', 30), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'No files uploaded' });
    }

    const uploadedFiles = await Promise.all(req.files.map((file) => uploadSingleToCloudinary(req, file)));

    await MediaFile.insertMany(uploadedFiles.map((file) => ({
      ...file,
      uploadedBy: req.admin._id
    })));

    res.json({
      message: 'Files uploaded successfully',
      files: uploadedFiles.map((file) => ({
        filename: file.filename,
        url: file.url,
        publicId: file.publicId,
        size: file.size,
        mimetype: file.mimetype,
        type: file.type,
        folder: file.folder
      }))
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   DELETE /api/upload
// @desc    Delete file
// @access  Private/Admin
router.delete('/', protect, adminOnly, async (req, res) => {
  try {
    const { url, publicId } = req.body;
    
    if (!url && !publicId) {
      return res.status(400).json({ message: 'File URL or publicId is required' });
    }

    const mediaFile = await MediaFile.findOne(publicId ? { publicId } : { url });

    if (!mediaFile) {
      return res.status(404).json({ message: 'File not found' });
    }

    await cloudinary.uploader.destroy(mediaFile.publicId, {
      resource_type: mediaFile.resourceType === 'video' ? 'video' : 'image'
    });

    await mediaFile.deleteOne();

    res.json({ message: 'File deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   DELETE /api/upload/bulk
// @desc    Delete multiple files
// @access  Private/Admin
router.delete('/bulk', protect, adminOnly, async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'Media file IDs are required' });
    }

    const mediaFiles = await MediaFile.find({ _id: { $in: ids } });

    await Promise.all(mediaFiles.map((mediaFile) => (
      cloudinary.uploader.destroy(mediaFile.publicId, {
        resource_type: mediaFile.resourceType === 'video' ? 'video' : 'image'
      })
    )));

    await MediaFile.deleteMany({ _id: { $in: mediaFiles.map((file) => file._id) } });

    res.json({
      message: 'Files deleted successfully',
      deletedCount: mediaFiles.length
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST /api/upload/assign
// @desc    Assign an uploaded media URL to project/blog target fields
// @access  Private/Admin
router.post('/assign', protect, adminOnly, async (req, res) => {
  try {
    const { url, targetType, targetId, targetField } = req.body;

    if (!url || !targetType || !targetId || !targetField) {
      return res.status(400).json({ message: 'url, targetType, targetId, and targetField are required' });
    }

    if (targetType === 'project') {
      const project = await Project.findById(targetId);

      if (!project) {
        return res.status(404).json({ message: 'Project not found' });
      }

      if (targetField === 'cardImage') {
        project.cardImage = url;
      } else if (targetField === 'heroImage') {
        project.hero = { ...(project.hero || {}), image: url };
      } else if (targetField === 'gallery') {
        const gallery = Array.isArray(project.gallery) ? project.gallery : [];
        const alreadyExists = gallery.some((item) => item.url === url);

        if (!alreadyExists) {
          gallery.push({
            url,
            caption: '',
            order: gallery.length
          });
        }

        project.gallery = gallery;

        if (!Array.isArray(project.sections)) {
          project.sections = [];
        }

        let gallerySection = project.sections.find((section) => section.sectionType === 'gallery' || section.type === 'gallery');

        if (!gallerySection) {
          gallerySection = {
            id: `section-gallery-${Date.now()}`,
            sectionType: 'gallery',
            type: 'gallery',
            order: project.sections.length,
            backgroundColor: '#ffffff',
            textColor: '#1a202c',
            components: []
          };
          project.sections.push(gallerySection);
        }

        if (!Array.isArray(gallerySection.components) || gallerySection.components.length === 0) {
          gallerySection.components = [];
        }

        const hasGalleryTitle = gallerySection.components.some((component) => component.type === 'title' && component.content);
        if (!hasGalleryTitle) {
          gallerySection.components.unshift({
            id: `component-${Date.now()}`,
            type: 'title',
            content: 'Gallery',
            items: [],
            images: []
          });
        }

        let imageComponent = gallerySection.components.find((component) => component.type === 'images');

        if (!imageComponent) {
          imageComponent = {
            id: `component-images-${Date.now()}`,
            type: 'images',
            content: '',
            items: [],
            images: []
          };
          gallerySection.components.push(imageComponent);
        }

        const existingSectionImage = Array.isArray(imageComponent.images)
          ? imageComponent.images.some((image) => image.url === url)
          : false;

        if (!existingSectionImage) {
          if (!Array.isArray(imageComponent.images)) {
            imageComponent.images = [];
          }

          imageComponent.images.push({
            id: `gallery-image-${Date.now()}`,
            url,
            caption: '',
            alt: '',
            order: imageComponent.images.length
          });
        }
      } else {
        return res.status(400).json({ message: 'Invalid project target field' });
      }

      await project.save();
      return res.json({ message: 'Image assigned to project successfully' });
    }

    if (targetType === 'blog') {
      const blog = await Blog.findById(targetId);

      if (!blog) {
        return res.status(404).json({ message: 'Blog not found' });
      }

      if (targetField !== 'featuredImage') {
        return res.status(400).json({ message: 'Invalid blog target field' });
      }

      blog.featuredImage = url;
      await blog.save();

      return res.json({ message: 'Image assigned to blog successfully' });
    }

    return res.status(400).json({ message: 'Invalid target type' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
