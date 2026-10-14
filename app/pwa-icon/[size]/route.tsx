import { ImageResponse } from "next/og";
import { iconImage } from "../draw";

const SIZES = { "192": [192, false], "512": [512, false], maskable: [512, true] } as const;

export function generateStaticParams() {
  return Object.keys(SIZES).map((size) => ({ size }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const spec = SIZES[(await params).size as keyof typeof SIZES];
  if (!spec) return new Response(null, { status: 404 });
  return new ImageResponse(iconImage(spec[0], spec[1]), { width: spec[0], height: spec[0] });
}
