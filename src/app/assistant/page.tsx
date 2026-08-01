import { Phone, ShieldAlert, Sparkles } from "lucide-react";
import type { Metadata } from "next";

import { Card, CardContent } from "@/components/ui/card";
import { AssistantChat } from "@/features/ai/components/assistant-chat";

export const metadata: Metadata = {
  title: "AI health assistant",
  description:
    "Describe your symptoms and get guidance on which medical specialty fits and how urgently you should be seen. Not a diagnosis.",
};

export default function AssistantPage() {
  return (
    <div className="container max-w-4xl py-10">
      <div className="mb-6 space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-primary">
          <Sparkles aria-hidden className="size-4" />
          Health assistant
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">
          Not sure which specialist you need?
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          Describe what you are experiencing. The assistant suggests the right specialty and how
          soon to be seen, then points you at doctors who can help.
        </p>
      </div>

      <Card className="mb-6 border-destructive/30 bg-destructive/5">
        <CardContent className="flex items-start gap-3 py-4">
          <ShieldAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div className="space-y-1 text-sm">
            <p className="font-medium text-destructive">This is not emergency care</p>
            <p className="text-muted-foreground">
              If you have chest pain, difficulty breathing, signs of a stroke, severe bleeding, or
              thoughts of harming yourself, call your local emergency number now.
            </p>
            <p className="flex items-center gap-1.5 text-muted-foreground">
              <Phone aria-hidden className="size-3.5" />
              Pakistan: <strong className="text-foreground">1122</strong>
            </p>
          </div>
        </CardContent>
      </Card>

      <AssistantChat />
    </div>
  );
}
