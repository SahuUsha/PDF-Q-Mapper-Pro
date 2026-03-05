
import React from 'react';
import { QuestionMapping } from '../types';

interface JsonViewerProps {
  data: QuestionMapping[];
}

const JsonViewer: React.FC<JsonViewerProps> = ({ data }) => {
  const downloadJson = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "mapped_questions.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  if (data.length === 0) return null;

  return (
    <div className="mt-8 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex justify-between items-center">
        <h2 className="font-semibold text-slate-700">Generated Mapping ({data.length} Questions)</h2>
        <button
          onClick={downloadJson}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          Download JSON
        </button>
      </div>
      <div className="p-6 overflow-x-auto">
        <pre className="text-xs font-mono text-slate-800 bg-slate-900 text-slate-100 p-4 rounded-lg max-h-[600px] overflow-y-auto">
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
    </div>
  );
};

export default JsonViewer;
