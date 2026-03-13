const cloudinary = require('cloudinary').v2;

const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'drgu9bfh0';
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || '592549684146675';
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;

if (!CLOUDINARY_API_SECRET) {
  console.warn('⚠️ CLOUDINARY_API_SECRET is not set. Uploads will fail until it is configured.');
}

cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME,
  api_key: CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET
});

const slugify = (value = '') => value
  .toString()
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/(^-|-$)/g, '');

const buildCloudinaryFolder = ({
  type = 'general',
  category = '',
  entity = '',
  field = ''
} = {}) => {
  const baseFolder = process.env.CLOUDINARY_BASE_FOLDER || 'StreamRock';
  const folderParts = [baseFolder, type];

  const safeCategory = slugify(category);
  const safeEntity = slugify(entity);
  const safeField = slugify(field);

  if (safeCategory) folderParts.push(safeCategory);
  if (safeEntity) folderParts.push(safeEntity);
  if (safeField) folderParts.push(safeField);

  return folderParts.join('/');
};

const uploadBufferToCloudinary = (buffer, options = {}) => (
  new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: options.folder,
        resource_type: options.resourceType || 'auto',
        overwrite: false
      },
      (error, result) => {
        if (error) {
          return reject(error);
        }

        resolve(result);
      }
    );

    uploadStream.end(buffer);
  })
);

module.exports = {
  cloudinary,
  buildCloudinaryFolder,
  uploadBufferToCloudinary
};