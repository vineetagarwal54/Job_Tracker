import { useMemo } from "react";
import { STATUSES, PRIORITIES } from "../constants";

// Returns the jobs array filtered by the given criteria and sorted by sortBy.
// Memoized so job list renders don't re-run this work on unrelated state changes.
export function useJobSorting(jobs, filters) {
  const { filterStatus, filterResume, filterPriority, search, sortBy } = filters;

  return useMemo(() => {
    const q = search.toLowerCase();
    const filtered = jobs
      .filter(j => filterStatus === "All" || j.status === filterStatus)
      .filter(j => filterResume === "All" || j.resume === filterResume)
      .filter(j => filterPriority === "All" || j.priority === filterPriority)
      .filter(j => !q ||
        j.company.toLowerCase().includes(q) ||
        j.role.toLowerCase().includes(q) ||
        (j.location || "").toLowerCase().includes(q)
      );

    if (sortBy === "custom") return filtered;

    return [...filtered].sort((a, b) => {
      if (sortBy === "date") return new Date(b.date) - new Date(a.date);
      if (sortBy === "deadline") {
        if (!a.deadline) return 1;
        if (!b.deadline) return -1;
        return new Date(a.deadline) - new Date(b.deadline);
      }
      if (sortBy === "company") return a.company.localeCompare(b.company);
      if (sortBy === "status") return STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status);
      if (sortBy === "priority") return PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority);
      return 0;
    });
  }, [jobs, filterStatus, filterResume, filterPriority, search, sortBy]);
}
