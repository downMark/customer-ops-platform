interface AvatarProps {
  name: string;
  className?: string;
}

/** Initials avatar — avoids external image dependencies. */
const Avatar = ({ name, className = "w-10 h-10" }: AvatarProps) => {
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div
      className={`${className} rounded-full bg-primary-container text-on-primary flex items-center justify-center font-bold text-label-sm shrink-0`}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
};

export default Avatar;
