
import React, { useState, useEffect } from 'react';
import { mapQuestionsWithTextbook } from './services/geminiService';
import { ProcessingState, MappingBatch, FileProcessingResult, QuestionMapping } from './types';
import JSZip from 'jszip';

const App: React.FC = () => {
  const [state, setState] = useState<ProcessingState>({
    isProcessing: false,
    batches: [
      { id: 'initial-batch', name: 'Batch 1', questionFiles: [] }
    ],
  });
  const [optionalInstructions, setOptionalInstructions] = useState<string>('');
  const [useLatex, setUseLatex] = useState<boolean>(false);
  const [previewFile, setPreviewFile] = useState<{ url: string; name: string; type: string; content?: string } | null>(null);

  useEffect(() => {
    return () => {
      if (previewFile?.url) {
        URL.revokeObjectURL(previewFile.url);
      }
    };
  }, [previewFile]);

  const addBatch = () => {
    const newId = Math.random().toString(36).substr(2, 9);
    setState(prev => ({
      ...prev,
      batches: [...prev.batches, { id: newId, name: `Batch ${prev.batches.length + 1}`, questionFiles: [] }]
    }));
  };

  const removeBatch = (batchId: string) => {
    setState(prev => ({
      ...prev,
      batches: prev.batches.filter(b => b.id !== batchId)
    }));
  };

  const updateBatchTextbook = (batchId: string, file: File) => {
    setState(prev => ({
      ...prev,
      batches: prev.batches.map(b => b.id === batchId ? { ...b, textbookFile: file } : b)
    }));
  };

  const addQuestionFilesToBatch = (batchId: string, files: FileList) => {
    const newFiles: FileProcessingResult[] = Array.from(files).map((file: File) => ({
      id: Math.random().toString(36).substr(2, 9),
      name: file.name,
      file: file,
      status: 'pending' as const,
      progress: 0,
    }));
    setState(prev => ({
      ...prev,
      batches: prev.batches.map(b => b.id === batchId ? { ...b, questionFiles: [...b.questionFiles, ...newFiles] } : b)
    }));
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64 = reader.result?.toString().split(',')[1];
        if (base64) resolve(base64);
        else reject('Failed to convert file');
      };
      reader.onerror = error => reject(error);
    });
  };

  const fileToText = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsText(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    });
  };

  const downloadJson = (data: QuestionMapping[], filename: string) => {
    const jsonFilename = filename.replace(/\.[^/.]+$/, "") + ".json";
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", jsonFilename);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const handlePreview = async (file: File) => {
    if (previewFile?.url) URL.revokeObjectURL(previewFile.url);
    if (file.type === 'application/json' || file.name.endsWith('.json')) {
      const text = await fileToText(file);
      setPreviewFile({ url: '', name: file.name, type: 'json', content: text });
    } else {
      const url = URL.createObjectURL(file);
      setPreviewFile({ url, name: file.name, type: 'pdf' });
    }
  };

  const handleResultPreview = (file: FileProcessingResult, mode: 'plain' | 'latex' = 'plain') => {
    const data = mode === 'latex' ? file.latexData : file.data;
    if (!data) return;
    setPreviewFile({ 
      url: '', 
      name: `Results (${mode}): ${file.name}`, 
      type: 'result', 
      content: JSON.stringify(data, null, 2) 
    });
  };

  const processFileInBatch = async (batchId: string, qFile: FileProcessingResult, textbookJson: string) => {
    setState(prev => ({
      ...prev,
      batches: prev.batches.map(b => b.id === batchId ? {
        ...b,
        questionFiles: b.questionFiles.map(f => f.id === qFile.id ? { ...f, status: 'processing', progress: 20, error: undefined } : f)
      } : b)
    }));

    try {
      const qFileBase64 = await fileToBase64(qFile.file);
      
      let results: QuestionMapping[];
      let latexResults: QuestionMapping[] | undefined = undefined;

      if (useLatex) {
        // Parallel calls
        const [plain, latex] = await Promise.all([
          mapQuestionsWithTextbook(qFileBase64, textbookJson, qFile.name, optionalInstructions, false),
          mapQuestionsWithTextbook(qFileBase64, textbookJson, qFile.name, optionalInstructions, true)
        ]);
        results = plain;
        latexResults = latex;
      } else {
        results = await mapQuestionsWithTextbook(qFileBase64, textbookJson, qFile.name, optionalInstructions, false);
      }

      setState(prev => ({
        ...prev,
        batches: prev.batches.map(b => b.id === batchId ? {
          ...b,
          questionFiles: b.questionFiles.map(f => f.id === qFile.id ? { 
            ...f, 
            status: 'success', 
            data: results, 
            latexData: latexResults,
            progress: 100 
          } : f)
        } : b)
      }));
    } catch (err: any) {
      setState(prev => ({
        ...prev,
        batches: prev.batches.map(b => b.id === batchId ? {
          ...b,
          questionFiles: b.questionFiles.map(f => f.id === qFile.id ? { ...f, status: 'error', error: err.message, progress: 0 } : f)
        } : b)
      }));
    }
  };

  const runBatchProcessing = async (batchId: string) => {
    const batch = state.batches.find(b => b.id === batchId);
    if (!batch || !batch.textbookFile || batch.questionFiles.length === 0) return;

    const textbookJson = await fileToText(batch.textbookFile);
    const filesToProcess = batch.questionFiles.filter(f => f.status !== 'success');
    
    await Promise.all(filesToProcess.map(qFile => processFileInBatch(batchId, qFile, textbookJson)));
  };

  const processBatch = async (batchId: string) => {
    setState(prev => ({ ...prev, isProcessing: true }));
    try {
      await runBatchProcessing(batchId);
    } finally {
      setState(prev => ({ ...prev, isProcessing: false }));
    }
  };

  const processAllBatches = async () => {
    setState(prev => ({ ...prev, isProcessing: true }));
    try {
      await Promise.all(state.batches.map(batch => runBatchProcessing(batch.id)));
    } finally {
      setState(prev => ({ ...prev, isProcessing: false }));
    }
  };

  const downloadBatchAsZip = async (batchId: string) => {
    const batch = state.batches.find(b => b.id === batchId);
    if (!batch) return;

    const successfulFiles = batch.questionFiles.filter(f => f.status === 'success' && (f.data || f.latexData));
    if (successfulFiles.length === 0) return;

    const zip = new JSZip();
    successfulFiles.forEach(f => {
      const baseName = f.name.replace(/\.[^/.]+$/, "");
      if (f.data) {
        zip.file(`${baseName}_plain.json`, JSON.stringify(f.data, null, 2));
      }
      if (f.latexData) {
        zip.file(`${baseName}_latex.json`, JSON.stringify(f.latexData, null, 2));
      }
    });

    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const link = document.createElement('a');
    link.href = url;
    
    const textbookName = batch.textbookFile 
      ? batch.textbookFile.name.replace(/\.[^/.]+$/, "").replace(/\s+/g, '_') 
      : batch.name.replace(/\s+/g, '_');
      
    link.download = `${textbookName}_results.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const downloadAllResults = async () => {
    const zip = new JSZip();
    let hasContent = false;

    state.batches.forEach(batch => {
      const successfulFiles = batch.questionFiles.filter(f => f.status === 'success' && (f.data || f.latexData));
      if (successfulFiles.length > 0) {
        const folderName = batch.textbookFile 
          ? batch.textbookFile.name.replace(/\.[^/.]+$/, "") 
          : (batch.name || batch.id);
        const batchFolder = zip.folder(folderName);
        successfulFiles.forEach(f => {
          hasContent = true;
          const baseName = f.name.replace(/\.[^/.]+$/, "");
          if (f.data) {
            batchFolder?.file(`${baseName}_plain.json`, JSON.stringify(f.data, null, 2));
          }
          if (f.latexData) {
            batchFolder?.file(`${baseName}_latex.json`, JSON.stringify(f.latexData, null, 2));
          }
        });
      }
    });

    if (!hasContent) return;

    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const link = document.createElement('a');
    link.href = url;
    link.download = "all_mapped_results.zip";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-20 text-slate-900 font-sans">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white font-bold shadow-lg transform rotate-3">M</div>
            <div>
              <h1 className="text-lg font-bold text-slate-800 leading-none">PDF Q-Mapper Pro</h1>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest mt-1">Parallel Multi-Batch Indexing</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={addBatch}
              className="px-4 py-2 bg-indigo-50 text-indigo-600 rounded-lg text-sm font-bold hover:bg-indigo-100 transition-all flex items-center gap-2 border border-indigo-100"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
              New Batch
            </button>
            <button 
              onClick={processAllBatches}
              disabled={state.isProcessing || state.batches.every(b => !b.textbookFile)}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 transition-all shadow-md flex items-center gap-2"
            >
              {state.isProcessing ? (
                <div className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                  Processing Projects...
                </div>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  Process All Pairs
                </>
              )}
            </button>
            <button 
              onClick={downloadAllResults}
              className="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-bold hover:bg-slate-900 transition-all shadow-md flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              Zip All Results
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 mt-8">
        <div className="mb-6 bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-center gap-6">
          <div className="flex-1 w-full">
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Global Logic Instructions</label>
            <input 
              type="text" 
              value={optionalInstructions} 
              onChange={(e) => setOptionalInstructions(e.target.value)}
              className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
              placeholder="e.g. 'Use specific chapter numbering', 'Focus on subtopic levels 2 and 3'..."
            />
          </div>
          <div className="flex flex-col items-start gap-1">
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Output Format</label>
            <button 
              onClick={() => setUseLatex(!useLatex)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all border ${
                useLatex 
                ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' 
                : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'
              }`}
            >
              <div className={`w-8 h-4 rounded-full relative transition-colors ${useLatex ? 'bg-indigo-400' : 'bg-slate-200'}`}>
                <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${useLatex ? 'left-4.5' : 'left-0.5'}`} />
              </div>
              {useLatex ? 'LaTeX Mode ON' : 'Plain Text Mode'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-8">
          {state.batches.map((batch, batchIdx) => (
            <div key={batch.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col md:flex-row min-h-[400px] hover:shadow-md transition-shadow">
              {/* Batch Sidebar: Textbook and Control */}
              <div className="w-full md:w-80 bg-slate-50 border-r border-slate-200 p-6 flex flex-col">
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <span className="text-[10px] font-black text-indigo-500 uppercase tracking-tighter bg-indigo-50 px-2 py-0.5 rounded">Pair #{batchIdx + 1}</span>
                    <h2 className="text-lg font-bold text-slate-800 mt-1">{batch.name}</h2>
                  </div>
                  {state.batches.length > 1 && (
                    <button 
                      onClick={() => removeBatch(batch.id)}
                      className="text-slate-300 hover:text-red-500 p-1 rounded-lg transition-colors"
                      title="Remove Batch"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  )}
                </div>

                <div className="space-y-6 flex-1">
                  {/* Textbook Section */}
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Reference Textbook JSON</label>
                    <div className={`relative border-2 border-dashed rounded-xl p-4 transition-all text-center group ${batch.textbookFile ? 'border-green-200 bg-green-50' : 'border-slate-300 hover:border-indigo-400 bg-white'}`}>
                      <input 
                        type="file" 
                        accept="application/json" 
                        onChange={(e) => e.target.files?.[0] && updateBatchTextbook(batch.id, e.target.files[0])}
                        className="absolute inset-0 opacity-0 cursor-pointer" 
                      />
                      {batch.textbookFile ? (
                        <div className="flex flex-col items-center">
                          <div className="w-10 h-10 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-2">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                          </div>
                          <p className="text-xs font-bold text-green-700 truncate w-full px-2" title={batch.textbookFile.name}>{batch.textbookFile.name}</p>
                          <button onClick={() => handlePreview(batch.textbookFile!)} className="mt-2 text-[10px] text-indigo-600 font-bold hover:underline">Preview Index</button>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center py-4">
                          <svg className="w-8 h-8 text-slate-300 mb-2 group-hover:text-indigo-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
                          <p className="text-[10px] text-slate-500">Upload Reference</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Batch Actions */}
                  <div className="pt-4 border-t border-slate-200 space-y-3">
                    <button 
                      onClick={() => processBatch(batch.id)}
                      disabled={!batch.textbookFile || batch.questionFiles.length === 0 || state.isProcessing}
                      className="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold text-sm shadow-md hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none transition-all flex items-center justify-center gap-2"
                    >
                      Process This Batch
                    </button>
                    {batch.questionFiles.some(f => f.status === 'success') && (
                      <button 
                        onClick={() => downloadBatchAsZip(batch.id)}
                        className="w-full py-2.5 bg-slate-800 text-white rounded-xl font-bold text-xs shadow-md hover:bg-slate-900 transition-all flex items-center justify-center gap-2"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                        Download Batch ZIP
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Batch Main: Question Files Area */}
              <div className="flex-1 p-6 bg-white overflow-hidden flex flex-col">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    Source PDFs ({batch.questionFiles.length})
                  </h3>
                  <div className="relative">
                    <input 
                      type="file" 
                      multiple 
                      accept="application/pdf" 
                      onChange={(e) => e.target.files && addQuestionFilesToBatch(batch.id, e.target.files)} 
                      className="absolute inset-0 opacity-0 cursor-pointer" 
                    />
                    <button className="text-indigo-600 text-xs font-bold bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-100 hover:bg-indigo-100 transition-colors flex items-center gap-1">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                      Add Files
                    </button>
                  </div>
                </div>

                {batch.questionFiles.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-slate-300 border-2 border-dashed border-slate-100 rounded-2xl bg-slate-50/30 p-12">
                    <svg className="w-12 h-12 mb-4 opacity-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 4v16m8-8H4" /></svg>
                    <p className="text-sm font-medium">No question PDFs linked to this batch</p>
                    <p className="text-[10px] mt-1 text-slate-400 italic">Upload PDF files to start mapping against the reference above.</p>
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                    {batch.questionFiles.map(file => (
                      <div key={file.id} className={`flex items-center justify-between p-3 rounded-xl border transition-all ${file.status === 'success' ? 'bg-green-50/50 border-green-100' : 'bg-slate-50/50 border-slate-100'}`}>
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`p-2 rounded-lg flex-shrink-0 ${
                            file.status === 'success' ? 'bg-green-100 text-green-600' : 
                            file.status === 'error' ? 'bg-red-100 text-red-600' : 
                            file.status === 'processing' ? 'bg-blue-100 text-blue-600 animate-pulse' : 'bg-white text-slate-400'
                          }`}>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                          </div>
                          <div className="min-w-0">
                            <h4 className="text-xs font-bold text-slate-700 truncate">{file.name}</h4>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className={`text-[10px] uppercase font-black tracking-tighter ${file.status === 'success' ? 'text-green-500' : file.status === 'error' ? 'text-red-500' : 'text-slate-400'}`}>
                                {file.status}
                              </span>
                              {file.status === 'success' && file.data && (
                                <span className="text-[10px] font-bold text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded">
                                  {file.data.length} Questions
                                </span>
                              )}
                              {file.error && <span className="text-[9px] text-red-400 truncate max-w-[120px]" title={file.error}>• {file.error}</span>}
                              {file.status === 'processing' && <span className="text-[9px] text-blue-500 italic">Analyzing...</span>}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 ml-4">
                          <button onClick={() => handlePreview(file.file)} className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-white rounded-lg transition-colors" title="Preview PDF">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                          </button>
                          {file.status === 'success' && (
                            <div className="flex items-center gap-1">
                              {file.data && (
                                <div className="flex items-center bg-white rounded-lg border border-slate-200 p-0.5">
                                  <button onClick={() => handleResultPreview(file, 'plain')} className="p-1.5 text-indigo-500 hover:bg-slate-50 rounded-md transition-colors" title="View Plain JSON">
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
                                  </button>
                                  <button onClick={() => downloadJson(file.data!, `${file.name.replace(/\.[^/.]+$/, "")}_plain`)} className="p-1.5 text-green-600 hover:bg-slate-50 rounded-md transition-colors" title="Download Plain JSON">
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                  </button>
                                </div>
                              )}
                              {file.latexData && (
                                <div className="flex items-center bg-indigo-50 rounded-lg border border-indigo-100 p-0.5">
                                  <button onClick={() => handleResultPreview(file, 'latex')} className="p-1.5 text-indigo-600 hover:bg-white rounded-md transition-colors" title="View LaTeX JSON">
                                    <span className="text-[10px] font-bold">LX</span>
                                  </button>
                                  <button onClick={() => downloadJson(file.latexData!, `${file.name.replace(/\.[^/.]+$/, "")}_latex`)} className="p-1.5 text-indigo-600 hover:bg-white rounded-md transition-colors" title="Download LaTeX JSON">
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                          <button 
                            onClick={() => setState(prev => ({ ...prev, batches: prev.batches.map(b => b.id === batch.id ? { ...b, questionFiles: b.questionFiles.filter(f => f.id !== file.id) } : b) }))}
                            className="p-1.5 text-slate-300 hover:text-red-500 rounded-lg transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* Preview Modal */}
      {previewFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-md">
          <div className="bg-white rounded-3xl w-full max-w-6xl h-[94vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="px-8 py-5 border-b border-slate-200 flex items-center justify-between bg-white">
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-2xl flex items-center justify-center font-bold text-white shadow-lg ${previewFile.type === 'pdf' ? 'bg-red-500' : 'bg-indigo-600'}`}>
                  {previewFile.type === 'pdf' ? 'PDF' : '{}'}
                </div>
                <div>
                  <h3 className="font-bold text-slate-800 text-lg truncate max-w-xl">{previewFile.name}</h3>
                  <div className="flex items-center gap-2">
                    <p className="text-[10px] text-slate-400 uppercase tracking-[0.2em] font-black">{previewFile.type === 'result' ? 'GENERATED MAPPING' : 'SOURCE MATERIAL'}</p>
                    {previewFile.type === 'result' && previewFile.content && (
                      <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100">
                        {JSON.parse(previewFile.content).length} Questions Found
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <button 
                onClick={() => setPreviewFile(null)} 
                className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-all"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            
            <div className="flex-1 bg-slate-50 p-6 overflow-hidden">
              {(previewFile.type === 'json' || previewFile.type === 'result') ? (
                <div className="w-full h-full bg-slate-900 rounded-2xl p-8 overflow-auto text-indigo-200 font-mono text-xs leading-relaxed shadow-2xl relative group">
                  <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                       onClick={() => navigator.clipboard.writeText(previewFile.content || '')}
                       className="bg-slate-800 text-white px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-700 text-[10px]"
                    >
                      Copy JSON
                    </button>
                  </div>
                  <pre>{previewFile.content}</pre>
                </div>
              ) : (
                <object data={previewFile.url} type="application/pdf" className="w-full h-full rounded-2xl shadow-xl bg-white border border-slate-200">
                  <div className="flex flex-col items-center justify-center h-full bg-white p-12 text-center rounded-2xl">
                    <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mb-4">
                      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    </div>
                    <h3 className="text-lg font-bold text-slate-800 mb-2">Browser blocked the PDF viewer</h3>
                    <p className="text-slate-500 mb-6 text-sm">Security settings in your browser might prevent PDFs from rendering inside an embed. Use the button below to view it directly.</p>
                    <a href={previewFile.url} target="_blank" rel="noopener noreferrer" className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold shadow-lg hover:bg-indigo-700 transition-all flex items-center gap-2">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                      Open in New Window
                    </a>
                  </div>
                </object>
              )}
            </div>
            
            <div className="px-8 py-5 border-t border-slate-100 flex justify-end gap-3 bg-white">
               {(previewFile.type === 'json' || previewFile.type === 'result') && (
                  <button 
                    onClick={() => {
                      const blob = new Blob([previewFile.content || ''], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = previewFile.name.endsWith('.json') ? previewFile.name : `${previewFile.name}.json`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    className="px-6 py-2.5 bg-indigo-50 text-indigo-600 rounded-xl font-bold text-sm border border-indigo-100 hover:bg-indigo-100 transition-all"
                  >
                    Download Object
                  </button>
               )}
              <button onClick={() => setPreviewFile(null)} className="px-8 py-2.5 bg-slate-900 text-white rounded-xl font-bold text-sm hover:bg-black transition-all shadow-lg">Close Preview</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
