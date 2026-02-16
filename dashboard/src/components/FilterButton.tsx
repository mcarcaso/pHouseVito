interface FilterButtonProps {
  active: boolean;
  onClick: () => void;
  title: string;
  emoji: string;
}

export default function FilterButton({ active, onClick, title, emoji }: FilterButtonProps) {
  return (
    <button
      className={`w-9 h-9 flex items-center justify-center rounded-md border bg-neutral-900 border-neutral-800 text-base cursor-pointer transition-all hover:bg-neutral-850 hover:border-neutral-700 ${
        active ? 'opacity-40 text-neutral-500 hover:opacity-60' : 'text-neutral-200'
      }`}
      onClick={onClick}
      title={title}
    >
      {emoji}
    </button>
  );
}
