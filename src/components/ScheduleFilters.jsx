import React, { useState, useEffect } from 'react';

const ScheduleFilters = ({ data, onFilterChange }) => {
  const uniqueModels = React.useMemo(() => {
    if (!data) return [];
    const models = new Set();
    data.forEach(item => {
      if (item["Model"]) models.add(item["Model"]);
    });
    return ['', ...Array.from(models).sort()];
  }, [data]);

  const uniqueModelYears = React.useMemo(() => {
    if (!data) return [];
    const years = new Set();
    data.forEach(item => {
      if (item["Model Year"]) years.add(item["Model Year"]);
    });
    return ['', ...Array.from(years).sort()];
  }, [data]);

  const uniqueDealers = React.useMemo(() => {
    if (!data) return [];
    const dealers = new Set();
    data.forEach(item => {
      if (item["Dealer"]) dealers.add(item["Dealer"]);
    });
    return ['all', ...Array.from(dealers).sort()];
  }, [data]);

  const regentProductionStages = React.useMemo(() => {
    if (!data) return [];
    const stages = new Set();
    data.forEach(item => {
      const stage = item["Regent Production"];
      if (!stage || stage.toLowerCase() === "finished") return;
      if (stage.includes('-')) {
        stages.add("Sea Freighting");
      } else {
        stages.add(stage);
      }
    });
    return Array.from(stages).sort();
  }, [data]);

  const [filters, setFilters] = useState({
    type: '',
    dealer: '',
    forecastYear: '',
    forecastYearMonth: '',
    selectedStages: [],
    modelRange: '',
    model: '',
    modelYear: '',
    OrderSentToLongtreeYearMonth: '',
    PlansSentToDealerYearMonth: '',
    SignedPlansReceivedYearMonth: '',
    allStagesSelected: true
  });

  useEffect(() => {
    if (regentProductionStages.length > 0 && filters.selectedStages.length === 0) {
      setFilters(prev => ({
        ...prev,
        selectedStages: [...regentProductionStages],
        allStagesSelected: true
      }));
    }
  }, [regentProductionStages]);

  const forecastYears = React.useMemo(() => {
    const years = new Set();
    data?.forEach(item => {
      const parts = item["Forecast Production Date"]?.split('/');
      if (parts?.length >= 3) years.add(parts[2]);
    });
    return ['', ...Array.from(years).filter(y => y !== "2024").sort()];
  }, [data]);

  const forecastMonths = React.useMemo(() => {
    const months = new Set();
    data?.forEach(item => {
      const parts = item["Forecast Production Date"]?.split('/');
      if (parts?.length >= 3 && parts[2] === filters.forecastYear) {
        months.add(`${parts[2]}-${parts[1]}`);
      }
    });
    return ['', ...Array.from(months).sort()];
  }, [data, filters.forecastYear]);

  const modelRanges = React.useMemo(() => {
    const prefixes = new Set();
    data?.forEach(item => {
      if (item["Chassis"]?.length >= 3) prefixes.add(item["Chassis"].substring(0, 3));
    });
    return ['', ...Array.from(prefixes).sort()];
  }, [data]);

  const handleFilterChange = (filterName, value) => {
    if (filterName === 'forecastYear') {
      setFilters(prev => ({
        ...prev,
        forecastYear: value,
        forecastYearMonth: ''
      }));
    } else {
      setFilters(prev => ({ ...prev, [filterName]: value }));
    }
  };

  const handleStageChange = (stage) => {
    setFilters(prev => {
      if (stage === "all") {
        const allSelected = !prev.allStagesSelected;
        return {
          ...prev,
          selectedStages: allSelected ? [...regentProductionStages] : [],
          allStagesSelected: allSelected
        };
      }

      const updated = prev.selectedStages.includes(stage)
        ? prev.selectedStages.filter(s => s !== stage)
        : [...prev.selectedStages, stage];

      return {
        ...prev,
        selectedStages: updated,
        allStagesSelected: updated.length === regentProductionStages.length
      };
    });
  };

  useEffect(() => {
    onFilterChange(filters);
  }, [filters, onFilterChange]);

  const getMonthName = (num) => ["", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ][parseInt(num, 10)];

  const formatYearMonth = (ym) => {
    if (!ym) return 'All Months';
    const [year, month] = ym.split('-');
    return `${getMonthName(month)} ${year}`;
  };

  return (
    <div className="bg-white p-4 rounded-lg shadow-sm mb-6 text-base" style={{ zoom: '125%' }}>
      <h2 className="text-lg font-medium text-gray-800 mb-4">Filters</h2>
        {/* Type Filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
          <select
            className="w-full border rounded py-2 px-3"
            value={filters.type}
            onChange={(e) => handleFilterChange('type', e.target.value)}
          >
            <option value="">All Types</option>
            <option value="stock">Stock</option>
            <option value="customer">Customer</option>
          </select>
        </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Dealer */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Dealer</label>
          <select
            className="w-full border rounded py-2 px-3"
            value={filters.dealer}
            onChange={(e) => handleFilterChange('dealer', e.target.value)}
          >
            <option value="">All Dealers</option>
            {uniqueDealers.map(d => d !== 'all' && <option key={d} value={d}>{d}</option>)}
          </select>
        </div>

        {/* Model */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Model</label>
          <select
            className="w-full border rounded py-2 px-3"
            value={filters.model}
            onChange={(e) => handleFilterChange('model', e.target.value)}
          >
            <option value="">All Models</option>
            {uniqueModels.map(m => m && <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        {/* Model Year - NEW */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Model Year</label>
          <select
            className="w-full border rounded py-2 px-3"
            value={filters.modelYear}
            onChange={(e) => handleFilterChange('modelYear', e.target.value)}
          >
            <option value="">All Years</option>
            {uniqueModelYears.map(yr => <option key={yr} value={yr}>{yr}</option>)}
          </select>
        </div>

        {/* Forecast Year */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Forecast Year</label>
          <select
            className="w-full border rounded py-2 px-3"
            value={filters.forecastYear}
            onChange={(e) => handleFilterChange('forecastYear', e.target.value)}
          >
            {forecastYears.map(yr => <option key={yr} value={yr}>{yr || 'All Years'}</option>)}
          </select>
        </div>

        {/* Forecast Month */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Forecast Month</label>
          <select
            className="w-full border rounded py-2 px-3"
            value={filters.forecastYearMonth}
            onChange={(e) => handleFilterChange('forecastYearMonth', e.target.value)}
            disabled={!filters.forecastYear}
          >
            {forecastMonths.map(m => <option key={m} value={m}>{formatYearMonth(m)}</option>)}
          </select>
        </div>

        {/* Model Range */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Model Range</label>
          <select
            className="w-full border rounded py-2 px-3"
            value={filters.modelRange}
            onChange={(e) => handleFilterChange('modelRange', e.target.value)}
          >
            {modelRanges.map(r => <option key={r} value={r}>{r || 'All Ranges'}</option>)}
          </select>
        </div>

        {/* Type Filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
          <select
            className="w-full border rounded py-2 px-3"
            value={filters.type}
            onChange={(e) => handleFilterChange('type', e.target.value)}
          >
            <option value="">All Types</option>
            <option value="stock">Stock</option>
            <option value="customer">Customer</option>
          </select>
        </div>
      </div>

      {/* Clear Filters */}
      <div className="mt-4 flex justify-end">
        <button
          onClick={() => setFilters({
            dealer: '',
            forecastYear: '',
            forecastYearMonth: '',
            selectedStages: [...regentProductionStages],
            modelRange: '',
            model: '',
            modelYear: '',
            OrderSentToLongtreeYearMonth: '',
            PlansSentToDealerYearMonth: '',
            SignedPlansReceivedYearMonth: '',
            allStagesSelected: true
          })}
          className="bg-gray-200 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-300"
        >
          Clear Filters
        </button>
      </div>
    </div>
  );
};

export default ScheduleFilters;
