import React, { useState } from 'react';
import { TranscriptionItem } from '../types';

interface TranscriptCardProps {
  item: TranscriptionItem;
}

const TranscriptCard: React.FC<TranscriptCardProps> = ({ item }) => {
  const [copiedOriginal, setCopiedOriginal] = useState(false);
  const [copiedTranslated, setCopiedTranslated] = useState(false);

  const handleCopy = (text: string, isOriginal: boolean) => {
    navigator.clipboard.writeText(text);
    if (isOriginal) {
      setCopiedOriginal(true);
      setTimeout(() => setCopiedOriginal(false), 2000);
    } else {
      setCopiedTranslated(true);
      setTimeout(() => setCopiedTranslated(false), 2000);
    }
  };

  // Copy Icon SVG
  const CopyIcon = () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  );

  // Check Icon SVG
  const CheckIcon = () => (
    <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-4 transition-all duration-300 hover:shadow-md">
      {/* Original Text Section */}
      <div className="mb-3 pb-3 border-b border-slate-100">
        <div className="flex justify-between items-start gap-2">
          <p className="text-slate-500 text-sm font-medium mb-1">Original</p>
          <button
            onClick={() => handleCopy(item.originalText, true)}
            className="p-1.5 hover:bg-slate-100 rounded-md transition-colors text-slate-400 hover:text-slate-600"
            title="Copy original text"
          >
            {copiedOriginal ? <CheckIcon /> : <CopyIcon />}
          </button>
        </div>
        <p className="text-slate-800 text-base leading-relaxed font-medium">
          {item.originalText || <span className="italic text-slate-300">Listening...</span>}
        </p>
      </div>

      {/* Translated Text Section */}
      <div>
        <div className="flex justify-between items-start gap-2">
          <p className="text-blue-600 text-sm font-medium mb-1">Vietnamese Translation</p>
          <button
            onClick={() => handleCopy(item.translatedText, false)}
            className="p-1.5 hover:bg-blue-50 rounded-md transition-colors text-blue-400 hover:text-blue-600"
            title="Copy translation"
          >
            {copiedTranslated ? <CheckIcon /> : <CopyIcon />}
          </button>
        </div>
        <p className="text-blue-900 text-lg leading-relaxed font-semibold">
           {item.translatedText || (item.originalText ? <span className="animate-pulse text-blue-300">Translating...</span> : null)}
        </p>
      </div>
    </div>
  );
};

export default TranscriptCard;