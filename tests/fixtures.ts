export const media = Buffer.from('fake mp4 response');
export const playgroundModels = [
  { id: 'video-model', name: 'Video model', kind: 'video', description: 'A video model.',
    prompt: { max: 2000, required: true }, images: { max: 3, roles: ['start', 'end', 'ref'] }, video: { accepted: true },
    fields: [{ key: 'duration', label: 'Duration', type: 'range', min: 1, max: 10, step: 1, default: 5 }] },
  { id: 'image-model', name: 'Image model', kind: 'image', prompt: { max: 1000, required: true }, images: { max: 2 },
    fields: [{ key: 'size', label: 'Size', type: 'choice', options: [{ value: 'square', label: 'Square' }] }] },
];
export const editProject = { id: 'edit-1', name: 'Launch cut', version: 3, seconds: 7.5, updatedAt: '2026-11-12T10:00:00.000Z' };
export const editDoc = {
  sources: { 'job:job-1': { kind: 'video', name: 'Honey dance', max: 5 }, 'character:char-1': { kind: 'image', name: 'Alex', max: null } },
  tracks: [{ id: 1, volume: 1, muted: false }, { id: 2, volume: 0.5, muted: true }],
  clips: [
    { id: 2, track: 1, key: 'character:char-1', at: 5, start: 0, end: 2.5 },
    { id: 1, track: 1, key: 'job:job-1', at: 0, start: 0, end: 5 },
    { id: 3, track: 2, key: 'job:job-1', at: 0, start: 1.25, end: 5 },
  ],
};
export const template = {
  id: 'dance', title: 'Honey dance', category: 'dance', durationSeconds: 5,
  posterUrl: '/media/t/poster.jpg', previewUrl: '/media/t/preview.mp4', available: true,
  cardPreviewUrl: '/media/t/card.mp4', previewHqUrl: 'https://example.test/hq.mp4',
  posterVariants: [{ url: '/media/t/poster.webp', width: 320 }],
  videoVariants: [{ url: '/media/t/preview.webm', width: 320 }], renditionTimeline: 'timeline',
  qualities: [{ id: 'standard', label: 'Standard', credits: 12, model: 'fal-ai/private' }, { id: 'high', label: 'HD', credits: 24 }],
};
