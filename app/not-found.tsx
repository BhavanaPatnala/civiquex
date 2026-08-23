import Link from "next/link";
import { ShieldHalf } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
      <ShieldHalf className="h-8 w-8 text-muted-foreground" />
      <h1 className="text-lg font-semibold">Page not found</h1>
      <p className="max-w-sm text-sm text-muted-foreground">The page you&apos;re looking for doesn&apos;t exist or may have moved.</p>
      <Button asChild size="sm">
        <Link href="/">Back to overview</Link>
      </Button>
    </div>
  );
}
