export default function StatusBadge({ connected }: { connected: boolean }) {
  const live = connected;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
        live ? "bg-emerald-950 text-emerald-300" : "bg-red-950 text-red-300"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${live ? "bg-emerald-400" : "bg-red-400"}`}
      />
      {live ? "live" : "reconnecting"}
    </span>
  );
}