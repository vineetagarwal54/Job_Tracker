export function EmptyState({ hasActiveFilters }) {
  return (
    <div style={{ textAlign: "center", padding: "80px", color: "#5a6070", fontSize: "15px" }}>
      {hasActiveFilters ? "No jobs match your filters." : "No jobs yet. Add your first application!"}
    </div>
  );
}
