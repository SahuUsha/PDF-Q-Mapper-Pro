
export enum Difficulty {
  EASY = 'easy',
  MEDIUM = 'medium',
  HARD = 'hard'
}

export interface QuestionMapping {
  question: string;
  options: string[];
  answer: string;
  difficulty: Difficulty;
  explanation: string;
  board: string;
  exam: string[];
  subject: string;
  chapter_number: string;
  chapter_name: string;
  topic_number: string;
  topic_name: string;
  subtopics_number: string[];
  page: string[];
  language: string;
  grade: string;
  generated_by: string;
  question_type: 'pnmcq' | 'ptmcq';
}

export interface FileProcessingResult {
  id: string;
  name: string;
  file: File;
  status: 'pending' | 'processing' | 'success' | 'error';
  data?: QuestionMapping[];
  latexData?: QuestionMapping[];
  error?: string;
  progress: number;
}

export interface MappingBatch {
  id: string;
  name: string;
  textbookFile?: File;
  questionFiles: FileProcessingResult[];
}

export interface ProcessingState {
  isProcessing: boolean;
  batches: MappingBatch[];
}
