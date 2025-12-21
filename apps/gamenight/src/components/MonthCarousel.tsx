import { useState, memo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { format, addMonths, subMonths } from 'date-fns';

interface MonthCarouselProps {
  onMonthChange: (newDate: Date) => void;
  onTodayClick: () => void;
}

function MonthCarousel({ onMonthChange, onTodayClick }: MonthCarouselProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [isAnimating, setIsAnimating] = useState(false);

  // Notify parent when current month changes
  useEffect(() => {
    onMonthChange(currentMonth);
  }, [currentMonth, onMonthChange]);

  const shouldShowYear = (date: Date) => {
    const month = date.getMonth();
    return month === 11 || month === 0; // December or January
  };

  const handleNext = () => {
    if (isAnimating) return;

    setIsAnimating(true);
    setCurrentMonth((prev) => addMonths(prev, 1));
    setTimeout(() => setIsAnimating(false), 300);
  };

  const handlePrev = () => {
    if (isAnimating) return;

    setIsAnimating(true);
    setCurrentMonth((prev) => subMonths(prev, 1));
    setTimeout(() => setIsAnimating(false), 300);
  };

  const handleTodayClick = () => {
    if (isAnimating) return;

    setCurrentMonth(new Date());
    onTodayClick();
  };

  // Generate the three visible months (prev, current, next)
  const prevMonth = subMonths(currentMonth, 1);
  const nextMonth = addMonths(currentMonth, 1);

  const months = [
    { date: prevMonth, position: -1, id: 'prev' },
    { date: currentMonth, position: 0, id: 'current' },
    { date: nextMonth, position: 1, id: 'next' },
  ];

  return (
    <div className="flex flex-col items-center space-y-6 max-w-full">
      {/* Today Button */}
      <button
        onClick={handleTodayClick}
        className="px-4 py-2 text-sm text-indigo-600 hover:text-indigo-700 border border-indigo-200 rounded-md hover:bg-indigo-50 transition-colors"
      >
        Today
      </button>

      {/* Navigation Controls */}
      <div className="flex items-center space-x-4">
        <button
          onClick={handlePrev}
          disabled={isAnimating}
          className="p-2 text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>

        {/* Month Display */}
        <div className="relative w-48 h-16 flex items-center justify-center overflow-hidden">
          {months.map((month) => {
            const isActive = month.position === 0;
            const x = month.position * 80;
            const scale = isActive ? 1 : 0.8;
            const opacity = isActive ? 1 : 0.5;

            return (
              <motion.div
                key={month.id}
                className={`absolute text-center select-none ${
                  isActive ? 'text-gray-900' : 'text-gray-500'
                }`}
                initial={{ x, scale, opacity }}
                animate={{ x, scale, opacity }}
                transition={{
                  type: 'spring',
                  stiffness: 300,
                  damping: 30,
                  duration: 0.3,
                }}
              >
                {shouldShowYear(month.date) && (
                  <div className="text-gray-400 font-medium text-xs">
                    {format(month.date, 'yyyy')}
                  </div>
                )}
                <div className={`font-bold ${isActive ? 'text-lg' : 'text-sm'}`}>
                  {format(month.date, 'MMM')}
                </div>
              </motion.div>
            );
          })}
        </div>

        <button
          onClick={handleNext}
          disabled={isAnimating}
          className="p-2 text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default memo(MonthCarousel);
