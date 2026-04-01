/**
 * Unit tests for ReviewFormComponent.
 *
 * Strategy:
 *  - vi.mock('@angular/core') replaces inject() so ReviewService and ToastService
 *    resolve from mocks.  Signals and EventEmitter keep their real implementations.
 *  - URL.createObjectURL / URL.revokeObjectURL are stubbed in beforeEach because
 *    jsdom does not implement the Blob URL API.
 *  - File objects are created with Object.defineProperty override on `size` so we
 *    can simulate oversized files without allocating real large buffers.
 *  - ReviewService.submit() returns an Observable; mocked with of() / throwError().
 *  - No ngOnInit — orderId is set directly after construction.
 *
 * Coverage:
 *  - Initial signal state and plain-field defaults
 *  - onDragOver(): preventDefault + isDragging flag
 *  - Image file validation (MIME type, size, max-6 cap, mix valid+invalid)
 *  - Preview URLs created / revoked via URL.createObjectURL / revokeObjectURL
 *  - removeFile(): removes file+preview at index, revokes URL, leaves others intact
 *  - submit(): body guard, submitting guard, payload forwarded, success path
 *    (toast, reset, emit), error path (apiError, fallback), submitting reset
 *  - formatBytes() utility exposed on component: B / KB / MB formatting
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { inject } from '@angular/core';
import { of, throwError } from 'rxjs';
import { ReviewFormComponent } from './review-form.component';
import { ReviewService } from '../../core/services/review.service';
import { ToastService } from '../../core/services/toast.service';
import type { Review } from '../../core/models/review.model';
import { MAX_IMAGES, MAX_IMAGE_SIZE_BYTES } from '../../core/models/review.model';

// ── Mock @angular/core: keep signals + EventEmitter real, replace inject ──────

vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, inject: vi.fn() };
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_REVIEW: Review = {
  id: 'rev-1',
  orderId: 'order-1',
  customerId: 'user-1',
  body: 'Great product!',
  isFollowup: false,
  parentReviewId: null,
  moderationStatus: 'pending',
  submittedAt: '2025-01-01T00:00:00Z',
  images: [],
};

/**
 * Build a File with a controlled `size` property.
 * jsdom's File reads size from content; we override it to simulate oversized files
 * without allocating multi-MB buffers.
 */
function makeFile(
  name = 'photo.jpg',
  type = 'image/jpeg',
  sizeBytes = 1024,
): File {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: sizeBytes, configurable: true });
  return f;
}

/** Simulate a file-input change event carrying the given files. */
function makeInputChangeEvent(files: File[]): Event {
  const input = Object.assign(document.createElement('input'), { type: 'file' });
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  const event = new Event('change');
  Object.defineProperty(event, 'target', { value: input, configurable: true });
  return event;
}

/** Simulate a drag-drop event carrying the given files.
 *  jsdom does not expose DragEvent as a constructor, so we use a plain object cast. */
function makeDropEvent(files: File[]): DragEvent {
  return {
    preventDefault: vi.fn(),
    dataTransfer: { files },
  } as unknown as DragEvent;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReviewSvc(review: Review = MOCK_REVIEW) {
  return {
    submit:          vi.fn().mockReturnValue(of(review)),
    submitFollowup:  vi.fn().mockReturnValue(of(review)),
  };
}

function makeToast() {
  return { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
}

function makeComponent(
  reviewSvc = makeReviewSvc(),
  toast     = makeToast(),
  orderId   = 'order-1',
) {
  vi.mocked(inject).mockImplementation((token: unknown) => {
    if (token === ReviewService) return reviewSvc;
    if (token === ToastService)  return toast;
    return undefined;
  });
  const component = new ReviewFormComponent();
  component.orderId = orderId;
  return { component, reviewSvc, toast };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ReviewFormComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom does not implement Blob URL API — stub both static methods.
    // createObjectURL returns unique URLs so tests can distinguish per-file previews.
    let urlSeq = 0;
    global.URL.createObjectURL = vi.fn().mockImplementation(() => `blob:mock-preview-${urlSeq++}`);
    global.URL.revokeObjectURL = vi.fn();
  });

  // ── Initial state ──────────────────────────────────────────────────────────

  describe('initial state', () => {
    it('submitting starts false', () => {
      const { component } = makeComponent();
      expect(component.submitting()).toBe(false);
    });

    it('apiError starts null', () => {
      const { component } = makeComponent();
      expect(component.apiError()).toBeNull();
    });

    it('selectedFiles starts as an empty array', () => {
      const { component } = makeComponent();
      expect(component.selectedFiles()).toEqual([]);
    });

    it('previews starts as an empty array', () => {
      const { component } = makeComponent();
      expect(component.previews()).toEqual([]);
    });

    it('validationErrors starts as an empty array', () => {
      const { component } = makeComponent();
      expect(component.validationErrors()).toEqual([]);
    });

    it('bodyText starts as an empty string', () => {
      const { component } = makeComponent();
      expect(component.bodyText).toBe('');
    });

    it('isDragging starts false', () => {
      const { component } = makeComponent();
      expect(component.isDragging).toBe(false);
    });

    it('MAX_IMAGES is 6', () => {
      const { component } = makeComponent();
      expect(component.MAX_IMAGES).toBe(6);
    });
  });

  // ── onDragOver() ──────────────────────────────────────────────────────────

  describe('onDragOver()', () => {
    it('prevents the default browser behaviour', () => {
      const { component } = makeComponent();
      const event = { preventDefault: vi.fn() } as unknown as DragEvent;
      component.onDragOver(event);
      expect(event.preventDefault).toHaveBeenCalledOnce();
    });

    it('sets isDragging to true', () => {
      const { component } = makeComponent();
      const event = { preventDefault: vi.fn() } as unknown as DragEvent;
      component.onDragOver(event);
      expect(component.isDragging).toBe(true);
    });
  });

  // ── MIME type validation ───────────────────────────────────────────────────

  describe('MIME type validation', () => {
    it('accepts image/jpeg files', () => {
      const { component } = makeComponent();
      component.onFileChange(makeInputChangeEvent([makeFile('photo.jpg', 'image/jpeg')]));
      expect(component.selectedFiles()).toHaveLength(1);
      expect(component.validationErrors()).toHaveLength(0);
    });

    it('accepts image/png files', () => {
      const { component } = makeComponent();
      component.onFileChange(makeInputChangeEvent([makeFile('photo.png', 'image/png')]));
      expect(component.selectedFiles()).toHaveLength(1);
      expect(component.validationErrors()).toHaveLength(0);
    });

    it('rejects files that are not JPEG or PNG', () => {
      const { component } = makeComponent();
      component.onFileChange(makeInputChangeEvent([makeFile('doc.pdf', 'application/pdf')]));
      expect(component.selectedFiles()).toHaveLength(0);
      expect(component.validationErrors()).toHaveLength(1);
    });

    it('sets a human-readable error message for invalid MIME type', () => {
      const { component } = makeComponent();
      component.onFileChange(makeInputChangeEvent([makeFile('doc.pdf', 'application/pdf')]));
      expect(component.validationErrors()[0].error).toContain('must be JPEG or PNG');
    });

    it('rejects GIF files', () => {
      const { component } = makeComponent();
      component.onFileChange(makeInputChangeEvent([makeFile('anim.gif', 'image/gif')]));
      expect(component.selectedFiles()).toHaveLength(0);
      expect(component.validationErrors()).toHaveLength(1);
    });

    it('rejects WebP files', () => {
      const { component } = makeComponent();
      component.onFileChange(makeInputChangeEvent([makeFile('photo.webp', 'image/webp')]));
      expect(component.selectedFiles()).toHaveLength(0);
    });
  });

  // ── Size validation ────────────────────────────────────────────────────────

  describe('size validation (≤ 5 MB)', () => {
    it('accepts a file exactly at the 5 MB boundary', () => {
      const { component } = makeComponent();
      const file = makeFile('ok.jpg', 'image/jpeg', MAX_IMAGE_SIZE_BYTES);
      component.onFileChange(makeInputChangeEvent([file]));
      expect(component.selectedFiles()).toHaveLength(1);
      expect(component.validationErrors()).toHaveLength(0);
    });

    it('rejects a file 1 byte over the 5 MB limit', () => {
      const { component } = makeComponent();
      const file = makeFile('big.jpg', 'image/jpeg', MAX_IMAGE_SIZE_BYTES + 1);
      component.onFileChange(makeInputChangeEvent([file]));
      expect(component.selectedFiles()).toHaveLength(0);
      expect(component.validationErrors()).toHaveLength(1);
    });

    it('sets an error message that mentions the file size in MB', () => {
      const { component } = makeComponent();
      // 6.2 MB file
      const file = makeFile('big.jpg', 'image/jpeg', Math.round(6.2 * 1024 * 1024));
      component.onFileChange(makeInputChangeEvent([file]));
      expect(component.validationErrors()[0].error).toMatch(/6\.2 MB/);
    });

    it('sets an error message that mentions the 5 MB cap', () => {
      const { component } = makeComponent();
      const file = makeFile('big.jpg', 'image/jpeg', MAX_IMAGE_SIZE_BYTES + 1);
      component.onFileChange(makeInputChangeEvent([file]));
      expect(component.validationErrors()[0].error).toContain('max 5 MB');
    });

    it('accepts a small file (100 KB)', () => {
      const { component } = makeComponent();
      const file = makeFile('small.png', 'image/png', 100 * 1024);
      component.onFileChange(makeInputChangeEvent([file]));
      expect(component.selectedFiles()).toHaveLength(1);
    });
  });

  // ── Max 6 images cap ──────────────────────────────────────────────────────

  describe('max 6 images cap', () => {
    it('accepts exactly 6 files', () => {
      const { component } = makeComponent();
      const files = Array.from({ length: 6 }, (_, i) =>
        makeFile(`photo${i}.jpg`, 'image/jpeg'),
      );
      component.onFileChange(makeInputChangeEvent(files));
      expect(component.selectedFiles()).toHaveLength(6);
    });

    it('trims a batch of 7 files to 6 (first 6 kept)', () => {
      const { component } = makeComponent();
      const files = Array.from({ length: 7 }, (_, i) =>
        makeFile(`photo${i}.jpg`, 'image/jpeg'),
      );
      component.onFileChange(makeInputChangeEvent(files));
      expect(component.selectedFiles()).toHaveLength(6);
    });

    it('does not add more files when already at capacity', () => {
      const { component } = makeComponent();
      // Fill to max
      const batch1 = Array.from({ length: 6 }, (_, i) =>
        makeFile(`photo${i}.jpg`, 'image/jpeg'),
      );
      component.onFileChange(makeInputChangeEvent(batch1));
      // Try to add more
      const batch2 = [makeFile('extra.jpg', 'image/jpeg')];
      component.onFileChange(makeInputChangeEvent(batch2));
      expect(component.selectedFiles()).toHaveLength(6);
    });

    it('fills remaining slots when partially full', () => {
      const { component } = makeComponent();
      // Add 4 files
      const batch1 = Array.from({ length: 4 }, (_, i) =>
        makeFile(`photo${i}.jpg`, 'image/jpeg'),
      );
      component.onFileChange(makeInputChangeEvent(batch1));
      // Add 5 more — only 2 slots remain
      const batch2 = Array.from({ length: 5 }, (_, i) =>
        makeFile(`more${i}.png`, 'image/png'),
      );
      component.onFileChange(makeInputChangeEvent(batch2));
      expect(component.selectedFiles()).toHaveLength(6);
    });

    it('does not set validationErrors when at capacity (files are simply dropped)', () => {
      const { component } = makeComponent();
      const batch1 = Array.from({ length: 6 }, (_, i) =>
        makeFile(`photo${i}.jpg`, 'image/jpeg'),
      );
      component.onFileChange(makeInputChangeEvent(batch1));
      component.onFileChange(makeInputChangeEvent([makeFile('extra.jpg', 'image/jpeg')]));
      // The extra file was sliced away before validation — no error raised
      expect(component.validationErrors()).toHaveLength(0);
    });
  });

  // ── Mixed valid + invalid files ────────────────────────────────────────────

  describe('mixed valid and invalid files in one batch', () => {
    it('adds only the valid files from a mixed batch', () => {
      const { component } = makeComponent();
      const goodFile = makeFile('good.jpg', 'image/jpeg');
      const badFile  = makeFile('bad.pdf', 'application/pdf');
      component.onFileChange(makeInputChangeEvent([goodFile, badFile]));
      expect(component.selectedFiles()).toHaveLength(1);
      expect(component.selectedFiles()[0].name).toBe('good.jpg');
    });

    it('records errors only for the invalid files', () => {
      const { component } = makeComponent();
      const goodFile = makeFile('good.png', 'image/png');
      const badFile  = makeFile('bad.pdf', 'application/pdf');
      component.onFileChange(makeInputChangeEvent([goodFile, badFile]));
      expect(component.validationErrors()).toHaveLength(1);
      expect(component.validationErrors()[0].file.name).toBe('bad.pdf');
    });

    it('replaces previous validationErrors on each new file pick', () => {
      const { component } = makeComponent();
      component.onFileChange(makeInputChangeEvent([makeFile('bad.pdf', 'application/pdf')]));
      expect(component.validationErrors()).toHaveLength(1);

      // Second pick with only valid files clears previous errors
      component.onFileChange(makeInputChangeEvent([makeFile('good.jpg', 'image/jpeg')]));
      expect(component.validationErrors()).toHaveLength(0);
    });

    it('does not add any files when all candidates are invalid', () => {
      const { component } = makeComponent();
      component.onFileChange(
        makeInputChangeEvent([
          makeFile('a.pdf', 'application/pdf'),
          makeFile('b.gif', 'image/gif'),
        ]),
      );
      expect(component.selectedFiles()).toHaveLength(0);
    });
  });

  // ── Preview URL management ─────────────────────────────────────────────────

  describe('preview URL management', () => {
    it('calls URL.createObjectURL for each valid file added', () => {
      const { component } = makeComponent();
      component.onFileChange(
        makeInputChangeEvent([
          makeFile('a.jpg', 'image/jpeg'),
          makeFile('b.png', 'image/png'),
        ]),
      );
      expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    });

    it('stores the returned blob URL in previews', () => {
      const { component } = makeComponent();
      component.onFileChange(makeInputChangeEvent([makeFile('a.jpg', 'image/jpeg')]));
      // The URL comes from URL.createObjectURL — it must start with "blob:"
      expect(component.previews()[0]).toMatch(/^blob:/);
    });

    it('previews and selectedFiles arrays stay in sync (same length)', () => {
      const { component } = makeComponent();
      component.onFileChange(
        makeInputChangeEvent([
          makeFile('a.jpg', 'image/jpeg'),
          makeFile('b.png', 'image/png'),
          makeFile('c.jpg', 'image/jpeg'),
        ]),
      );
      expect(component.previews()).toHaveLength(component.selectedFiles().length);
    });

    it('does not create a preview URL for invalid files', () => {
      const { component } = makeComponent();
      component.onFileChange(makeInputChangeEvent([makeFile('doc.pdf', 'application/pdf')]));
      expect(URL.createObjectURL).not.toHaveBeenCalled();
    });
  });

  // ── Drop zone ─────────────────────────────────────────────────────────────

  describe('onDrop()', () => {
    it('prevents the default browser behaviour', () => {
      const { component } = makeComponent();
      const event = makeDropEvent([makeFile('a.jpg', 'image/jpeg')]);
      component.onDrop(event);
      expect(event.preventDefault).toHaveBeenCalledOnce();
    });

    it('sets isDragging to false', () => {
      const { component } = makeComponent();
      component.isDragging = true;
      const event = makeDropEvent([]);
      component.onDrop(event);
      expect(component.isDragging).toBe(false);
    });

    it('adds dropped files to selectedFiles', () => {
      const { component } = makeComponent();
      const event = makeDropEvent([makeFile('a.jpg', 'image/jpeg')]);
      component.onDrop(event);
      expect(component.selectedFiles()).toHaveLength(1);
    });

    it('handles an empty drop (no files) without error', () => {
      const { component } = makeComponent();
      const event = makeDropEvent([]);
      expect(() => component.onDrop(event)).not.toThrow();
      expect(component.selectedFiles()).toHaveLength(0);
    });
  });

  // ── removeFile() ──────────────────────────────────────────────────────────

  describe('removeFile()', () => {
    function setupWithFiles(count: number) {
      const { component, reviewSvc, toast } = makeComponent();
      const files = Array.from({ length: count }, (_, i) =>
        makeFile(`photo${i}.jpg`, 'image/jpeg'),
      );
      component.onFileChange(makeInputChangeEvent(files));
      return { component, reviewSvc, toast };
    }

    it('removes the file at the given index from selectedFiles', () => {
      const { component } = setupWithFiles(3);
      const before = component.selectedFiles().map((f) => f.name);
      component.removeFile(1);
      const after = component.selectedFiles().map((f) => f.name);
      expect(after).toHaveLength(2);
      expect(after).not.toContain(before[1]);
    });

    it('removes the preview at the given index from previews', () => {
      const { component } = setupWithFiles(3);
      const previewsBefore = [...component.previews()];
      component.removeFile(1);
      expect(component.previews()).toHaveLength(2);
      expect(component.previews()).not.toContain(previewsBefore[1]);
    });

    it('calls URL.revokeObjectURL for the removed preview', () => {
      const { component } = setupWithFiles(2);
      const previewToRevoke = component.previews()[0];
      component.removeFile(0);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith(previewToRevoke);
    });

    it('does not revoke URLs of other previews', () => {
      const { component } = setupWithFiles(2);
      component.removeFile(0);
      expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    });

    it('keeps files at other indices intact', () => {
      const { component } = setupWithFiles(3);
      const nameAtIndex2 = component.selectedFiles()[2].name;
      component.removeFile(0);
      // After removing index 0, old index 2 is now index 1
      expect(component.selectedFiles()[1].name).toBe(nameAtIndex2);
    });

    it('results in an empty array after removing the only file', () => {
      const { component } = setupWithFiles(1);
      component.removeFile(0);
      expect(component.selectedFiles()).toHaveLength(0);
      expect(component.previews()).toHaveLength(0);
    });
  });

  // ── submit() — guards ──────────────────────────────────────────────────────

  describe('submit() — guards', () => {
    it('does not call reviewSvc.submit when bodyText is empty', async () => {
      const reviewSvc = makeReviewSvc();
      const { component } = makeComponent(reviewSvc);
      component.bodyText = '';
      await component.submit();
      expect(reviewSvc.submit).not.toHaveBeenCalled();
    });

    it('does not call reviewSvc.submit when bodyText is whitespace only', async () => {
      const reviewSvc = makeReviewSvc();
      const { component } = makeComponent(reviewSvc);
      component.bodyText = '   ';
      await component.submit();
      expect(reviewSvc.submit).not.toHaveBeenCalled();
    });

    it('does not call reviewSvc.submit when submitting is already true', async () => {
      const reviewSvc = makeReviewSvc();
      const { component } = makeComponent(reviewSvc);
      component.bodyText = 'Great product!';
      component.submitting.set(true);
      await component.submit();
      expect(reviewSvc.submit).not.toHaveBeenCalled();
    });
  });

  // ── submit() — success path ────────────────────────────────────────────────

  describe('submit() — success', () => {
    async function submitSuccessfully(reviewSvc = makeReviewSvc(), toast = makeToast()) {
      const { component } = makeComponent(reviewSvc, toast);
      component.bodyText = '  Great product!  '; // has surrounding whitespace
      component.onFileChange(makeInputChangeEvent([makeFile('img.jpg', 'image/jpeg')]));
      await component.submit();
      return { component, reviewSvc, toast };
    }

    it('calls reviewSvc.submit with the orderId', async () => {
      const reviewSvc = makeReviewSvc();
      await submitSuccessfully(reviewSvc);
      expect(reviewSvc.submit).toHaveBeenCalledWith(
        'order-1',
        expect.any(String),
        expect.any(Array),
      );
    });

    it('passes the trimmed body text to reviewSvc.submit', async () => {
      const reviewSvc = makeReviewSvc();
      await submitSuccessfully(reviewSvc);
      expect(reviewSvc.submit).toHaveBeenCalledWith(
        expect.any(String),
        'Great product!',
        expect.any(Array),
      );
    });

    it('passes the current selectedFiles to reviewSvc.submit', async () => {
      const reviewSvc = makeReviewSvc();
      const { component } = makeComponent(reviewSvc);
      component.bodyText = 'Good';
      const file = makeFile('img.jpg', 'image/jpeg');
      component.onFileChange(makeInputChangeEvent([file]));
      await component.submit();
      const [, , files] = reviewSvc.submit.mock.calls[0];
      expect(files).toHaveLength(1);
    });

    it('calls toast.success on success', async () => {
      const toast = makeToast();
      await submitSuccessfully(makeReviewSvc(), toast);
      expect(toast.success).toHaveBeenCalledOnce();
    });

    it('clears bodyText after success', async () => {
      const { component } = await submitSuccessfully();
      expect(component.bodyText).toBe('');
    });

    it('clears selectedFiles after success', async () => {
      const { component } = await submitSuccessfully();
      expect(component.selectedFiles()).toHaveLength(0);
    });

    it('clears previews after success', async () => {
      const { component } = await submitSuccessfully();
      expect(component.previews()).toHaveLength(0);
    });

    it('clears validationErrors after success', async () => {
      const { component } = await submitSuccessfully();
      expect(component.validationErrors()).toHaveLength(0);
    });

    it('emits the returned review via the submitted output', async () => {
      const reviewSvc = makeReviewSvc();
      const { component } = makeComponent(reviewSvc);
      component.bodyText = 'Great!';
      const emitted: Review[] = [];
      component.submitted.subscribe((r) => emitted.push(r));
      await component.submit();
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toEqual(MOCK_REVIEW);
    });

    it('resets submitting to false after success', async () => {
      const { component } = await submitSuccessfully();
      expect(component.submitting()).toBe(false);
    });

    it('clears any prior apiError before the new attempt', async () => {
      const reviewSvc = makeReviewSvc();
      const { component } = makeComponent(reviewSvc);
      component.apiError.set('previous error');
      component.bodyText = 'Great!';
      await component.submit();
      expect(component.apiError()).toBeNull();
    });
  });

  // ── submit() — error path ──────────────────────────────────────────────────

  describe('submit() — error', () => {
    it('calls toast.error with the API error message', async () => {
      const reviewSvc = makeReviewSvc();
      reviewSvc.submit.mockReturnValue(
        throwError(() => ({ error: { error: 'Review already submitted for this order.' } })),
      );
      const toast = makeToast();
      const { component } = makeComponent(reviewSvc, toast);
      component.bodyText = 'Second attempt';
      await component.submit();
      expect(toast.error).toHaveBeenCalledWith('Review already submitted for this order.');
    });

    it('calls toast.error with a fallback message when the API provides no message', async () => {
      const reviewSvc = makeReviewSvc();
      reviewSvc.submit.mockReturnValue(throwError(() => ({})));
      const toast = makeToast();
      const { component } = makeComponent(reviewSvc, toast);
      component.bodyText = 'Test';
      await component.submit();
      expect(toast.error).toHaveBeenCalledWith('Could not submit review — please try again.');
    });

    it('resets submitting to false after error', async () => {
      const reviewSvc = makeReviewSvc();
      reviewSvc.submit.mockReturnValue(throwError(() => ({})));
      const { component } = makeComponent(reviewSvc);
      component.bodyText = 'Test';
      await component.submit();
      expect(component.submitting()).toBe(false);
    });

    it('does not emit via submitted output on error', async () => {
      const reviewSvc = makeReviewSvc();
      reviewSvc.submit.mockReturnValue(throwError(() => ({})));
      const { component } = makeComponent(reviewSvc);
      component.bodyText = 'Test';
      const emitted: Review[] = [];
      component.submitted.subscribe((r) => emitted.push(r));
      await component.submit();
      expect(emitted).toHaveLength(0);
    });

    it('does not call toast.success on error', async () => {
      const reviewSvc = makeReviewSvc();
      reviewSvc.submit.mockReturnValue(throwError(() => ({})));
      const toast = makeToast();
      const { component } = makeComponent(reviewSvc, toast);
      component.bodyText = 'Test';
      await component.submit();
      expect(toast.success).not.toHaveBeenCalled();
    });
  });

  // ── formatBytes() utility ─────────────────────────────────────────────────

  describe('formatBytes() — exposed on component', () => {
    it('formats bytes below 1 KB as "X B"', () => {
      const { component } = makeComponent();
      expect(component.formatBytes(512)).toBe('512 B');
    });

    it('formats bytes below 1 MB as "X.X KB"', () => {
      const { component } = makeComponent();
      expect(component.formatBytes(2048)).toBe('2.0 KB');
    });

    it('formats bytes of 1 MB or more as "X.X MB"', () => {
      const { component } = makeComponent();
      expect(component.formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
    });

    it('formats exactly 5 MB as "5.0 MB"', () => {
      const { component } = makeComponent();
      expect(component.formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    });

    it('formats 0 bytes as "0 B"', () => {
      const { component } = makeComponent();
      expect(component.formatBytes(0)).toBe('0 B');
    });
  });
});
