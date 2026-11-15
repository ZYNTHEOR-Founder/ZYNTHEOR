/**
 * ZYNTHEOR Batch 29 — Multimodal Architecture Readiness Contracts
 *
 * Defines clean TypeScript interfaces and honest runtime capability discovery
 * across document understanding, vision, audio, and speech modalities.
 *
 * Zero Simulation Policy:
 *  - Only claims capabilities verified by real binary probes (`parserCapabilityReport`).
 *  - Any modality lacking a real backend engine/decoder is explicitly marked NOT IMPLEMENTED.
 */

import { parserCapabilityReport } from './DocumentBinaryParser.ts';

export type ModalityId =
  | 'document_understanding'
  | 'image_understanding'
  | 'audio_input'
  | 'speech_processing';

export type ModalityReadinessStatus = 'IMPLEMENTED' | 'PARTIAL' | 'NOT IMPLEMENTED';

export interface StructuredMediaMetadata {
  mediaId: string;
  modality: ModalityId;
  mimeType: string;
  byteSize: number;
  sha256: string;
  languageHint?: 'th' | 'en' | 'mixed';
  pageCount?: number;
  durationSeconds?: number;
  extractedAt?: string;
}

export interface ImageUnderstandingAdapter {
  readonly modality: 'image_understanding';
  inspectCapabilities(): Promise<{ status: ModalityReadinessStatus; reason: string }>;
  extractVisualContext(imageBytes: Buffer, mimeType: string): Promise<{
    supported: false;
    status: 'NOT IMPLEMENTED';
    reason: string;
  }>;
}

export interface DocumentUnderstandingAdapter {
  readonly modality: 'document_understanding';
  inspectCapabilities(): Promise<{
    status: ModalityReadinessStatus;
    pdfSupported: boolean;
    docxSupported: boolean;
    ocrSupported: boolean;
    engines: Record<string, string>;
  }>;
}

export interface AudioInputAdapter {
  readonly modality: 'audio_input';
  inspectCapabilities(): Promise<{ status: ModalityReadinessStatus; reason: string }>;
  transcribe(audioBytes: Buffer, mimeType: string): Promise<{
    supported: false;
    status: 'NOT IMPLEMENTED';
    reason: string;
  }>;
}

export interface SpeechProcessingAdapter {
  readonly modality: 'speech_processing';
  inspectCapabilities(): Promise<{ status: ModalityReadinessStatus; reason: string }>;
  synthesizeSpeech(text: string, lang: 'th' | 'en'): Promise<{
    supported: false;
    status: 'NOT IMPLEMENTED';
    reason: string;
  }>;
}

export interface ModalityRegistryEntry {
  modality: ModalityId;
  label: string;
  status: ModalityReadinessStatus;
  supportedFormats: string[];
  missingDependencies: string[];
  notes: string;
  details?: Record<string, unknown>;
}

const unimplementedVisionAdapter: ImageUnderstandingAdapter = {
  modality: 'image_understanding',
  async inspectCapabilities() {
    return {
      status: 'NOT IMPLEMENTED',
      reason: 'Native vision encoder weights and multimodal projection heads are not trained or loaded in this runtime.',
    };
  },
  async extractVisualContext(_imageBytes: Buffer, mimeType: string) {
    return {
      supported: false,
      status: 'NOT IMPLEMENTED',
      reason: `NOT IMPLEMENTED: Image understanding for '${mimeType}' requires a native vision encoder + OCR pipeline.`,
    };
  },
};

const unimplementedAudioAdapter: AudioInputAdapter = {
  modality: 'audio_input',
  async inspectCapabilities() {
    return {
      status: 'NOT IMPLEMENTED',
      reason: 'Server-side native audio feature extractor / ASR decoder is not implemented in this runtime.',
    };
  },
  async transcribe(_audioBytes: Buffer, mimeType: string) {
    return {
      supported: false,
      status: 'NOT IMPLEMENTED',
      reason: `NOT IMPLEMENTED: Audio transcription for '${mimeType}' has no server-side acoustic model in this build.`,
    };
  },
};

const unimplementedSpeechAdapter: SpeechProcessingAdapter = {
  modality: 'speech_processing',
  async inspectCapabilities() {
    return {
      status: 'NOT IMPLEMENTED',
      reason: 'Native neural TTS vocoder is not implemented on backend (browser Web Speech API stays optional client-side UI only).',
    };
  },
  async synthesizeSpeech(_text: string, lang: 'th' | 'en') {
    return {
      supported: false,
      status: 'NOT IMPLEMENTED',
      reason: `NOT IMPLEMENTED: Server-side speech synthesis (${lang}) requires a native TTS acoustic + vocoder checkpoint.`,
    };
  },
};

export async function getMultimodalCapabilityRegistry(): Promise<{
  checkedAt: string;
  policy: 'ZERO_SIMULATION_HONEST_CAPABILITY_REPORT';
  modalities: ModalityRegistryEntry[];
}> {
  const docCaps = await parserCapabilityReport();
  const visionCap = await unimplementedVisionAdapter.inspectCapabilities();
  const audioCap = await unimplementedAudioAdapter.inspectCapabilities();
  const speechCap = await unimplementedSpeechAdapter.inspectCapabilities();

  const textFormats = ['markdown', 'txt', 'json', 'csv', 'code', 'html', 'xml'];
  if (docCaps.pdf) textFormats.push('pdf (embedded text)');
  if (docCaps.docx) textFormats.push('docx');

  const docMissing: string[] = [];
  if (!docCaps.pdf) docMissing.push('pypdf / pdftotext');
  if (!docCaps.docx) docMissing.push('python-docx');
  if (!docCaps.ocr) docMissing.push('OCR engine (scanned PDFs not readable)');

  return {
    checkedAt: new Date().toISOString(),
    policy: 'ZERO_SIMULATION_HONEST_CAPABILITY_REPORT',
    modalities: [
      {
        modality: 'document_understanding',
        label: 'Document Text & Structural Extraction',
        status: docCaps.pdf || docCaps.docx ? 'PARTIAL' : 'PARTIAL',
        supportedFormats: textFormats,
        missingDependencies: docMissing,
        notes: 'Native text/markdown/JSON/CSV/code parsers are operational; PDF/DOCX rely on real Python probes; scanned OCR is NOT IMPLEMENTED.',
        details: docCaps,
      },
      {
        modality: 'image_understanding',
        label: 'Image & Visual Diagram Understanding',
        status: visionCap.status,
        supportedFormats: [],
        missingDependencies: ['native_vision_encoder', 'multimodal_projector', 'ocr_engine'],
        notes: visionCap.reason,
      },
      {
        modality: 'audio_input',
        label: 'Audio Ingestion & Speech Recognition (ASR)',
        status: audioCap.status,
        supportedFormats: [],
        missingDependencies: ['pcm_feature_extractor', 'native_asr_weights'],
        notes: audioCap.reason,
      },
      {
        modality: 'speech_processing',
        label: 'Neural Speech Synthesis (TTS)',
        status: speechCap.status,
        supportedFormats: [],
        missingDependencies: ['native_tts_acoustic_model', 'neural_vocoder'],
        notes: speechCap.reason,
      },
    ],
  };
}
