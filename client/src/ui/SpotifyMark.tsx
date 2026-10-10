export default function SpotifyMark({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="currentColor" />
      <path d="M6.4 9.3c3.8-1.1 8.2-.8 11.4.9M7.1 12.7c3.3-.8 7-.5 9.8.8M7.8 15.8c2.7-.6 5.8-.3 8.2.7" fill="none" stroke="#07120c" strokeLinecap="round" strokeWidth="1.6" />
    </svg>
  );
}
