import React from 'react';

const DialogWrapper = ({ isOpen, onClose, title, children }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white p-6 rounded-2xl shadow-2xl w-[90%] max-w-2xl transform transition-all animate-fadeIn">
        <div className="flex justify-between items-center mb-4 border-b pb-2">
          <h2 className="text-xl font-semibold text-gray-800">{title}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-red-500 text-2xl font-bold focus:outline-none"
            aria-label="Close"
          >
            &times;
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto text-gray-700">
          {children}
        </div>
      </div>
    </div>
  );
};

export default DialogWrapper;
