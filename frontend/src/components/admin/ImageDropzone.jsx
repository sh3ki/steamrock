import { useEffect, useMemo, useRef, useState } from 'react';
import { FiImage, FiUpload, FiX } from 'react-icons/fi';

const toPreviewItem = (item, index) => {
  if (!item) {
    return null;
  }

  if (item instanceof File) {
    return {
      key: `${item.name}-${item.size}-${index}`,
      label: item.name,
      isFile: true,
      item,
      src: URL.createObjectURL(item)
    };
  }

  if (typeof item === 'string') {
    return {
      key: `${item}-${index}`,
      label: `Image ${index + 1}`,
      isFile: false,
      item,
      src: item
    };
  }

  return null;
};

const ImageDropzone = ({
  accept = 'image/*',
  buttonLabel = 'Select Image',
  helperText = 'Click to select or drag and drop here',
  multiple = false,
  files = [],
  onFilesSelected,
  onRemove,
  className = ''
}) => {
  const inputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);

  const previewItems = useMemo(() => (
    (Array.isArray(files) ? files : [files]).map(toPreviewItem).filter(Boolean)
  ), [files]);

  useEffect(() => {
    return () => {
      previewItems.forEach((item) => {
        if (item.isFile && item.src.startsWith('blob:')) {
          URL.revokeObjectURL(item.src);
        }
      });
    };
  }, [previewItems]);

  const handleSelect = (event) => {
    const selectedFiles = Array.from(event.target.files || []);
    if (selectedFiles.length > 0) {
      onFilesSelected(selectedFiles);
    }
    event.target.value = '';
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setIsDragging(false);
    const selectedFiles = Array.from(event.dataTransfer.files || []);
    if (selectedFiles.length > 0) {
      onFilesSelected(selectedFiles);
    }
  };

  return (
    <div className={`space-y-3 ${className}`}>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`rounded-xl border-2 border-dashed p-5 text-center transition-colors ${
          isDragging ? 'border-primary bg-primary/5' : 'border-gray-300 bg-gray-50'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={handleSelect}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-white hover:bg-secondary"
        >
          <FiUpload className="h-4 w-4" />
          {buttonLabel}
        </button>
        <p className="mt-3 text-xs text-gray-500">{helperText}</p>
      </div>

      {previewItems.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {previewItems.map((previewItem, index) => (
            <div key={previewItem.key} className="relative overflow-hidden rounded-lg border border-gray-200 bg-white">
              <img src={previewItem.src} alt={previewItem.label} className="h-28 w-full object-cover" />
              {onRemove && (
                <button
                  type="button"
                  onClick={() => onRemove(index)}
                  className="absolute right-1 top-1 rounded-md bg-black/60 p-1 text-white hover:bg-black/80"
                >
                  <FiX className="h-3 w-3" />
                </button>
              )}
              <div className="flex items-center gap-1 px-2 py-1 text-[11px] text-gray-500">
                <FiImage className="h-3 w-3" />
                <span className="truncate">{previewItem.label}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ImageDropzone;
