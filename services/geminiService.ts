
import { GoogleGenAI, Type } from "@google/genai";
import { QuestionMapping, Difficulty } from "../types";

const ai = new GoogleGenAI({ apiKey: "AIzaSyATGrs5R3-1tCcAfsv_jZ_nhtN6pwdhk1A" });

/**
 * Sanitizes input text by removing literal \n, backslashes, and dollar signs.
 * If allowLatex is true, it preserves backslashes and dollar signs.
 */
const sanitizeString = (text: string, allowLatex: boolean = false): string => {
  if (typeof text !== 'string') return text;
  let sanitized = text
    .replace(/\\n/g, ' ') 
    .replace(/\n/g, ' ');

  if (!allowLatex) {
    sanitized = sanitized
      .replace(/\\/g, '')   
      .replace(/\$/g, '');
  }
  return sanitized;
};

/**
 * Recursively cleans all string properties in the generated objects.
 */
const deepCleanObject = (obj: any, allowLatex: boolean = false): any => {
  if (Array.isArray(obj)) {
    return obj.map(item => deepCleanObject(item, allowLatex));
  } else if (obj !== null && typeof obj === 'object') {
    const cleaned: any = {};
    for (const key in obj) {
      cleaned[key] = deepCleanObject(obj[key], allowLatex);
    }
    return cleaned;
  } else if (typeof obj === 'string') {
    return sanitizeString(obj, allowLatex);
  }
  return obj;
};

/**
 * Robustly parses the model's response text and cleans it.
 */
const parseAndCleanResponse = (text: string, allowLatex: boolean = false): QuestionMapping[] => {
  if (!text || text.trim() === '') return [];

  // Remove markdown code blocks if present
  let cleanedText = text.replace(/^```json\s*|```\s*$/g, '').trim();

  try {
    const parsed = JSON.parse(cleanedText);
    return deepCleanObject(parsed, allowLatex) as QuestionMapping[];
  } catch (e) {
    console.error("JSON Parse Error. Attempting recovery...");
    
    // Recovery for truncated JSON
    if (cleanedText.startsWith('[') && !cleanedText.endsWith(']')) {
      const lastCompleteObjectIndex = cleanedText.lastIndexOf('}');
      if (lastCompleteObjectIndex !== -1) {
        try {
          const truncatedJson = cleanedText.substring(0, lastCompleteObjectIndex + 1) + ']';
          const parsed = JSON.parse(truncatedJson);
          return deepCleanObject(parsed, allowLatex) as QuestionMapping[];
        } catch (innerError) {
          console.error("Recovery failed.");
        }
      }
    }
    throw new Error("The AI response was invalid or truncated. Please try again with a smaller file or clearer instructions.");
  }
};

export const mapQuestionsWithTextbook = async (
  questionPdfBase64: string,
  textbookJson: string,
  fileName: string,
  optionalInstructions?: string,
  useLatex: boolean = false
): Promise<QuestionMapping[]> => {
  const modelName = 'gemini-3.1-flash-lite-preview';

  // Pre-sanitize the textbook reference (always sanitize reference to avoid confusion)
  const sanitizedTextbookJson = sanitizeString(textbookJson, false);

  const latexRules = useLatex ? `
          STRICT OUTPUT FORMATTING RULES (LATEX MODE):
          - Use standard LaTeX for all mathematical formulas and equations.
          - Use "$" delimiters for inline math (e.g., "$E=mc^2$").
          - Use "$$" delimiters for block math.
          - Ensure all special characters in LaTeX are properly escaped within the JSON string (e.g., use "\\\\" for a single backslash in the final JSON).
          - DO NOT use literal newline characters "\n" within strings.
          - Output MUST be a valid JSON array.
  ` : `
          STRICT OUTPUT FORMATTING RULES (PLAIN TEXT MODE):
          - DO NOT use LaTeX delimiters like "$".
          - DO NOT use backslashes "\\".
          - DO NOT use literal newline characters "\n" within strings.
          - Convert all math formulas to plain, readable text (e.g., use 'rho' instead of '\rho', '^2' for square).
          - Output MUST be a valid JSON array.
  `;

  const response = await ai.models.generateContent({
    model: modelName,
    contents: {
      parts: [
        {
          text: `REFERENCE TEXTBOOK DATA (Sanitized):
          ${sanitizedTextbookJson}
          `
        },
        {
          inlineData: {
            mimeType: 'application/pdf',
            data: questionPdfBase64,
          },
        },
        {
          text: `You are an expert educational content mapper for NEET/JEE/NCERT Physics.
          
          TASK:
          1. Analyze the attached Question PDF: ${fileName}.
          2. Map every single question to the provided reference JSON.
          3. Extract structured metadata.
          4. IMPORTANT: The 'answer' field MUST be an exact string match to one of the values in the 'options' array. Do not use labels like 'A)', 'B)', etc. unless they are part of the option string itself.
          5. DO NOT include question numbers (e.g., "Q17", "17.", "Question 17:") in the 'question' field. Extract only the actual question text.

          ${latexRules}

          REQUIRED FIELDS PER QUESTION:
          - question: (string) Actual question text only. DO NOT include question numbers or prefixes like "Q17".
          - options: (array of 4 strings)
          - answer: (string) MUST exactly match one of the strings provided in the 'options' array.
          - difficulty: (easy/medium/hard)
          - explanation: (accurate physics logic)
          - board: "NCERT"
          - exam: ["NEET", "JEE"] (Always include both in the array)
          - subject: Detect from data
          - grade: Detect from data (e.g., "11", "12")
          - chapter_number: From reference
          - chapter_name: From reference
          - topic_number: From reference
          - topic_name: From reference
          - subtopics_number: (array of strings from reference)
          - page: (array of strings)
          - language: "English"
          - generated_by: "OCM"
          - question_type: 'pnmcq' (numerical) or 'ptmcq' (theory)
          - Fill all the fields even subtopics.

          ${optionalInstructions ? `ADDITIONAL USER INSTRUCTIONS: ${optionalInstructions}` : ''}
          
          IMPORTANT: Return ONLY the JSON array. Do not include introductory text.`
        }
      ]
    },
    config: {
      responseMimeType: "application/json"
    }
  });

  try {
    const text = response.text;
    if (!text) throw new Error("Model returned empty response");
    return parseAndCleanResponse(text, useLatex);
  } catch (error: any) {
    console.error(`Error processing ${fileName}:`, error);
    throw error;
  }
};