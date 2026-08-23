"use client";

import { useEffect, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { apiGet, apiPost, ApiError } from "@/lib/client/api";
import { useToast } from "@/components/ui/toast-provider";

interface AuthorityOption {
  id: string;
  name: string;
}

export function AuthorityResponseDialog({ incidentId, onDone }: { incidentId: string; onDone: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [eventType, setEventType] = useState("acknowledged");
  const [note, setNote] = useState("");
  const [redirectedToId, setRedirectedToId] = useState("");
  const [authorities, setAuthorities] = useState<AuthorityOption[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) apiGet<AuthorityOption[]>("/api/authorities").then(setAuthorities).catch(() => setAuthorities([]));
  }, [open]);

  async function submit() {
    setBusy(true);
    try {
      await apiPost(`/api/incidents/${incidentId}/verify`, {
        eventType,
        note: note || undefined,
        redirectedToId: eventType === "redirected" ? redirectedToId : undefined,
      });
      toast({ title: "Response recorded", variant: "success" });
      setOpen(false);
      onDone();
    } catch (err) {
      toast({ title: "Could not record response", description: err instanceof ApiError ? err.message : undefined, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          <Send className="h-4 w-4" />
          Respond as authority
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Authority response</DialogTitle>
          <DialogDescription>Every outcome here — including redirects — feeds the auditable routing feedback log.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Action</Label>
            <Select value={eventType} onValueChange={setEventType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="acknowledged">Acknowledge</SelectItem>
                <SelectItem value="action_reported">Report action taken</SelectItem>
                <SelectItem value="redirected">Redirect — wrong department</SelectItem>
                <SelectItem value="closed">Close</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {eventType === "redirected" && (
            <div className="flex flex-col gap-1.5">
              <Label>Redirect to</Label>
              <Select value={redirectedToId} onValueChange={setRedirectedToId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select authority" />
                </SelectTrigger>
                <SelectContent>
                  {authorities.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label>Note (optional)</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Vehicle removed by enforcement team" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || (eventType === "redirected" && !redirectedToId)}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Submit response
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
