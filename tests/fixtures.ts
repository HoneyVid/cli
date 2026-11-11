export const media = Buffer.from('fake mp4 response');
export const playgroundModels = [
  { id: 'video-model', name: 'Video model', kind: 'video', description: 'A video model.',
    prompt: { max: 2000, required: true }, images: { max: 3, roles: ['start', 'end', 'ref'] }, video: { accepted: true },
    fields: [{ key: 'duration', label: 'Duration', type: 'range', min: 1, max: 10, step: 1, default: 5 }] },
  { id: 'image-model', name: 'Image model', kind: 'image', prompt: { max: 1000, required: true }, images: { max: 2 },
    fields: [{ key: 'size', label: 'Size', type: 'choice', options: [{ value: 'square', label: 'Square' }] }] },
];
export const template = {
  id: 'dance', title: 'Honey dance', category: 'dance', durationSeconds: 5,
  posterUrl: '/media/t/poster.jpg', previewUrl: '/media/t/preview.mp4', available: true,
  cardPreviewUrl: '/media/t/card.mp4', previewHqUrl: 'https://example.test/hq.mp4',
  posterVariants: [{ url: '/media/t/poster.webp', width: 320 }],
  videoVariants: [{ url: '/media/t/preview.webm', width: 320 }], renditionTimeline: 'timeline',
  qualities: [{ id: 'standard', label: 'Standard', credits: 12, model: 'fal-ai/private' }, { id: 'high', label: 'HD', credits: 24 }],
};
