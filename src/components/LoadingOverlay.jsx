import React from 'react';

const LoadingOverlay = ({ isLoading, message = "Loading data..." }) => {
  if (!isLoading) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 bg-black bg-opacity-50">
      <div className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full animate-pulse">
        <div className="flex flex-col items-center">
          {/* Animated loading spinner */}
          <div className="w-16 h-16 mb-4">
            <svg className="animate-spin w-full h-full text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path 
                className="opacity-75" 
                fill="currentColor" 
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">
              </path>
            </svg>
          </div>
          
          {/* Loading text */}
          <h2 className="text-xl font-semibold text-gray-800 mb-2">
            {message}
          </h2>
          
          {/* Progress bar */}
          <div className="w-full bg-gray-200 rounded-full h-2.5 mb-4">
            <div className="bg-blue-600 h-2.5 rounded-full animate-[pulse_2s_ease-in-out_infinite] w-full"></div>
          </div>
          
          <p className="text-gray-600 text-center text-sm">
            Please wait while we prepare your dashboard data.
          </p>
        </div>
      </div>
    </div>
  );
};

export default LoadingOverlay;