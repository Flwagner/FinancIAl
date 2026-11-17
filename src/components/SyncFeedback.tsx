export default function SyncFeedback({ message, error }: { message: string; error: boolean }) {
  if (!message) return null;
  return <div className={`${error ? 'alert' : 'notice'} sync-market-feedback`} role={error ? 'alert' : 'status'}><ul><li>{message}</li></ul></div>;
}
