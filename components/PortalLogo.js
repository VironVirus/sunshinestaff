import Image from "next/image";

const sizeMap = {
  sm: {
    frame: "h-16 w-16 rounded-[20px]",
    title: "text-lg",
    subtitle: "text-[11px]",
  },
  md: {
    frame: "h-20 w-20 rounded-[24px]",
    title: "text-xl",
    subtitle: "text-xs",
  },
  lg: {
    frame: "h-24 w-24 rounded-[28px]",
    title: "text-3xl",
    subtitle: "text-sm",
  },
};

function joinClasses(...classes) {
  return classes.filter(Boolean).join(" ");
}

export default function PortalLogo({ size = "md", stacked = false, showText = true, className = "" }) {
  const preset = sizeMap[size] ?? sizeMap.md;

  return (
    <div
      className={joinClasses(
        "flex items-center gap-4",
        stacked ? "flex-col text-center" : "",
        className,
      )}
    >
      <div
        className={joinClasses(
          "overflow-hidden bg-white/95 p-2 shadow-[0_20px_45px_rgba(135,103,28,0.18)] ring-1 ring-white/80",
          preset.frame,
        )}
      >
        <Image
          src="/images/logo.jpg"
          alt="Sunshine Hotel logo"
          width={160}
          height={200}
          priority
          className="h-full w-full object-contain"
        />
      </div>

      {showText ? <div className={stacked ? "space-y-1" : "space-y-1.5"}>
        <p className="text-xs font-semibold uppercase tracking-[0.32em] text-[#8a6923]">
          Sunshine Hotel
        </p>
        <h1 className={joinClasses("font-display text-[#162338]", preset.title)}>
          Staff Command Portal
        </h1>
        <p className={joinClasses("max-w-md text-slate-600", preset.subtitle)}>
          Every stay; a reason to smile.
        </p>
      </div> : null}
    </div>
  );
}
