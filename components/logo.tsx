import Image from "next/image"

export default function Logo({
  size = "default",
  showText = false,
}: { size?: "default" | "small" | "large"; showText?: boolean }) {
  const sizeClasses = {
    small: "w-6 h-6",
    default: "w-8 h-8",
    large: "w-14 h-14",
  }

  const textSizes = {
    small: "text-xs",
    default: "text-sm",
    large: "text-xl",
  }

  return (
    <div className="flex items-center gap-2">
      <div className={`${sizeClasses[size]} relative flex-shrink-0`}>
        <Image
          src="/amanii_logo.png"
          alt="Amanii Logo"
          fill
          className="object-contain"
        />
      </div>
      {showText && <span className={`font-bold text-foreground ${textSizes[size]}`}>Mail Assistant</span>}
    </div>
  )
}
