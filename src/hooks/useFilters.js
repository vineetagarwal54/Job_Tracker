import { useState, useCallback, useMemo } from "react";

export function useFilters() {
  const [filterStatus, setFilterStatus] = useState("All");
  const [filterResume, setFilterResume] = useState("All");
  const [filterPriority, setFilterPriority] = useState("All");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("custom");

  const hasActiveFilters = useMemo(
    () => filterStatus !== "All" || filterPriority !== "All" || filterResume !== "All" || !!search,
    [filterStatus, filterPriority, filterResume, search]
  );

  const clearFilters = useCallback(() => {
    setFilterStatus("All");
    setFilterPriority("All");
    setFilterResume("All");
    setSearch("");
  }, []);

  return {
    filterStatus, setFilterStatus,
    filterResume, setFilterResume,
    filterPriority, setFilterPriority,
    search, setSearch,
    sortBy, setSortBy,
    hasActiveFilters, clearFilters,
  };
}
