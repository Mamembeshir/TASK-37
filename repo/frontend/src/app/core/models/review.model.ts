export type ModerationStatus = 'pending' | 'approved' | 'flagged';

export interface ReviewImage {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  uploadedAt: string;
}

export interface Review {
  id: string;
  orderId: string;
  customerId: string;
  body: string;
  isFollowup: boolean;
  parentReviewId: string | null;
  moderationStatus: ModerationStatus;
  submittedAt: string;
  images: ReviewImage[];
}

// ── Moderation status helpers ──────────────────────────────────────────────────

export const MODERATION_LABEL: Record<ModerationStatus, string> = {
  pending:  'Under Review',
  approved: 'Published',
  flagged:  'Flagged',
};

export const MODERATION_BADGE: Record<ModerationStatus, string> = {
  pending:  'bg-[#c4832a]/10 border border-[#c4832a]/20 text-[#c4832a]',
  approved: 'bg-[#c4832a]/10 border border-[#c4832a]/20 text-[#c4832a]',
  flagged:  'bg-red-500/10 border border-red-500/20 text-red-700',
};

export const MODERATION_ICON: Record<ModerationStatus, string> = {
  pending:  'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z',
  approved: 'm4.5 12.75 6 6 9-13.5',
  flagged:  'M3 3l1.664 1.664M21 21l-1.5-1.5m-5.485-1.242L12 17.25 4.5 21V8.742m.164-4.078a2.15 2.15 0 0 1 1.743-1.342 48.507 48.507 0 0 1 11.186 0c1.1.128 1.907 1.077 1.907 2.185V19.5M4.664 4.664 19.5 19.5',
};

// ── Client-side image validation ───────────────────────────────────────────────

export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_IMAGES = 6;
export const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png']);

export interface ImageValidationError {
  file: File;
  error: string;
}

export function validateImageFiles(files: File[]): {
  valid: File[];
  errors: ImageValidationError[];
} {
  const valid: File[] = [];
  const errors: ImageValidationError[] = [];

  for (const file of files) {
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      errors.push({ file, error: `"${file.name}" must be JPEG or PNG` });
    } else if (file.size > MAX_IMAGE_SIZE_BYTES) {
      const mb = (file.size / 1024 / 1024).toFixed(1);
      errors.push({ file, error: `"${file.name}" is ${mb} MB — max 5 MB` });
    } else {
      valid.push(file);
    }
  }

  return { valid, errors };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
