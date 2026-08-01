import {
  Activity,
  Baby,
  Bone,
  Brain,
  CalendarCheck,
  Ear,
  HeartPulse,
  MessageSquareHeart,
  ScanFace,
  Search,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Video,
} from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DoctorCard } from "@/features/doctors/components/doctor-card";
import { getDoctorRepository } from "@/features/doctors/repositories";
import { HomeSearchBar } from "@/features/doctors/components/home-search-bar";

export const revalidate = 300;

const SPECIALTIES = [
  { name: "Cardiology", Icon: HeartPulse },
  { name: "Dermatology", Icon: ScanFace },
  { name: "Paediatrics", Icon: Baby },
  { name: "Neurology", Icon: Brain },
  { name: "Orthopaedics", Icon: Bone },
  { name: "Psychiatry", Icon: MessageSquareHeart },
  { name: "ENT", Icon: Ear },
  { name: "Internal Medicine", Icon: Activity },
];

const STEPS = [
  {
    title: "Search with real filters",
    body: "Narrow by specialty, city, language, gender, fee and rating — then sort by who can actually see you soonest.",
    Icon: Search,
  },
  {
    title: "Pick a slot that is really free",
    body: "Availability comes from each doctor's live calendar. Your slot is held while you check out, so nobody takes it mid-booking.",
    Icon: CalendarCheck,
  },
  {
    title: "Meet in clinic or by video",
    body: "Join the consultation from the browser, or get directions to the clinic. Prescriptions and notes land in your record.",
    Icon: Video,
  },
];

export default async function HomePage() {
  const featured = await getDoctorRepository().findFeatured(4);

  return (
    <>
      <section className="surface-gradient border-b">
        <div className="container grid gap-10 py-16 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:py-24">
          <div className="space-y-6">
            <Badge variant="outline" className="bg-background/70">
              <ShieldCheck aria-hidden />
              Every doctor manually verified
            </Badge>

            <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
              Find the right doctor, and actually get seen.
            </h1>

            <p className="max-w-xl text-pretty text-lg text-muted-foreground">
              Search verified specialists across Pakistan, compare fees and real availability, and
              book an in-person or video consultation in under a minute.
            </p>

            <HomeSearchBar />

            <dl className="flex flex-wrap gap-x-10 gap-y-4 pt-2">
              {[
                { value: "1,200+", label: "Verified doctors" },
                { value: "38", label: "Specialties" },
                { value: "4.8★", label: "Average rating" },
              ].map((stat) => (
                <div key={stat.label}>
                  <dt className="sr-only">{stat.label}</dt>
                  <dd>
                    <span className="block text-2xl font-semibold">{stat.value}</span>
                    <span className="text-sm text-muted-foreground">{stat.label}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <Card className="border-primary/15 bg-card/80 backdrop-blur">
            <CardContent className="space-y-4 p-6">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Sparkles aria-hidden className="size-4 text-primary" />
                Not sure which specialist you need?
              </div>
              <p className="text-sm text-muted-foreground">
                Describe your symptoms and the assistant will suggest the right specialty, tell you
                how urgent it looks, and shortlist doctors who can see you soon.
              </p>
              <div className="rounded-lg border bg-background/60 p-4 text-sm">
                <p className="text-muted-foreground">
                  &ldquo;I&rsquo;ve had a tight chest and breathlessness climbing stairs for a
                  week.&rdquo;
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Badge variant="warning">Urgent — see someone today</Badge>
                  <Badge variant="secondary">Cardiology</Badge>
                </div>
              </div>
              <Button asChild variant="secondary" className="w-full">
                <Link href="/assistant">Try the symptom checker</Link>
              </Button>
              <p className="text-xs text-muted-foreground">
                Guidance only — never a diagnosis, and never a substitute for emergency care.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="container py-16">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Browse by specialty</h2>
            <p className="text-muted-foreground">Thirty-eight specialties, from cardiology to nutrition.</p>
          </div>
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href="/specialties">View all</Link>
          </Button>
        </div>

        <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {SPECIALTIES.map(({ name, Icon }) => (
            <li key={name}>
              <Link
                href={`/doctors?specialty=${encodeURIComponent(name)}`}
                className="flex items-center gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-accent"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
                  <Icon aria-hidden className="size-5" />
                </span>
                <span className="text-sm font-medium">{name}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="border-y bg-muted/30 py-16">
        <div className="container">
          <h2 className="text-2xl font-semibold tracking-tight">How booking works</h2>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {STEPS.map(({ title, body, Icon }, index) => (
              <Card key={title}>
                <CardContent className="space-y-3 p-6">
                  <div className="flex items-center gap-3">
                    <span className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
                      <Icon aria-hidden className="size-5" />
                    </span>
                    <span className="text-sm font-medium text-muted-foreground">
                      Step {index + 1}
                    </span>
                  </div>
                  <h3 className="font-semibold">{title}</h3>
                  <p className="text-sm text-muted-foreground">{body}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="container py-16">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Top rated this week</h2>
            <p className="text-muted-foreground">Ranked by patient rating and how soon they can see you.</p>
          </div>
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href="/doctors">See all doctors</Link>
          </Button>
        </div>

        {featured.length > 0 ? (
          <div className="mt-6 grid gap-4">
            {featured.map((doctor) => (
              <DoctorCard key={doctor.id} doctor={doctor} />
            ))}
          </div>
        ) : (
          <Card className="mt-6">
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <Stethoscope aria-hidden className="size-8 text-muted-foreground" />
              <p className="font-medium">No doctors published yet</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Run <code className="rounded bg-muted px-1.5 py-0.5">npm run db:seed</code> to load
                the sample directory, or approve a doctor from the admin panel.
              </p>
            </CardContent>
          </Card>
        )}
      </section>
    </>
  );
}
