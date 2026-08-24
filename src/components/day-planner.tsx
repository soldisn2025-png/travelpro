"use client";

import { useState, useTransition, type PointerEvent } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  type DragEndEvent,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { ArrowDown, ArrowUp, CalendarClock, Clock, Navigation, Route, Trash2 } from "lucide-react";
import {
  addAnchor,
  addSpotToDay,
  moveDayItem,
  moveDayItemToDay,
  removeDayItem,
  updateDayItemDuration,
  updateDayItemPlanning,
  updateDayItemTitle,
  updateDayPlanTimes,
} from "@/lib/actions";
import { formatDate, formatTime, timeToMinutes } from "@/lib/dates";
import { buildDirectionsUrl, dayColor } from "@/lib/map";
import type { DayItem, DayPlan, Spot } from "@/lib/types";
import { SubmitButton } from "@/components/submit-button";

function stopDragActivation(event: PointerEvent<HTMLElement>) {
  event.stopPropagation();
}

function isMealItem(item: DayItem) {
  const title = item.title.toLowerCase();
  return item.item_type === "fixed_anchor" && (title.includes("lunch") || title.includes("dinner"));
}

function getDisplayConflict(item: DayItem) {
  return item.conflict_reason;
}

// Dragging is unreliable once a city has several days, because the later day
// columns sit far below the spot list. The picker is the primary path; the drag
// handle stays for anyone who prefers it.
function DraggableSpot({
  spot,
  dayPlans,
  onAdded,
}: {
  spot: Spot;
  dayPlans: Array<DayPlan & { day_items: DayItem[] }>;
  onAdded: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `spot:${spot.id}`,
    data: { type: "spot", spot },
  });

  return (
    <div className="border border-zinc-200 bg-white shadow-sm">
      <button
        ref={setNodeRef}
        type="button"
        style={{
          transform: transform
            ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
            : undefined,
        }}
        className="w-full cursor-grab p-2 text-left text-xs active:cursor-grabbing"
        {...listeners}
        {...attributes}
      >
        <span className="block font-medium text-zinc-950">{spot.name}</span>
        <span className="mt-1 block text-zinc-500">{spot.duration_minutes} min</span>
      </button>
      {dayPlans.length ? (
        <form
          onPointerDown={stopDragActivation}
          action={async (formData) => {
            await addSpotToDay(formData);
            onAdded();
          }}
          className="flex items-center gap-1 border-t border-zinc-100 p-1"
        >
          <input type="hidden" name="spot_id" value={spot.id} />
          <input type="hidden" name="title" value={spot.name} />
          <input
            type="hidden"
            name="duration_minutes"
            value={spot.duration_minutes}
          />
          <select
            name="day_plan_id"
            defaultValue={dayPlans[0]?.id}
            aria-label={`Choose a day for ${spot.name}`}
            className="h-7 min-w-0 flex-1 border border-zinc-200 bg-white px-1 text-xs"
          >
            {dayPlans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {formatDate(plan.plan_date)}
              </option>
            ))}
          </select>
          <SubmitButton
            pendingText="..."
            className="h-7 shrink-0 border border-zinc-200 bg-white px-2 text-xs font-medium disabled:text-zinc-400"
          >
            Add
          </SubmitButton>
        </form>
      ) : null}
    </div>
  );
}

function DraggableDayItem({
  item,
  children,
}: {
  item: DayItem;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `day-item:${item.id}`,
      data: { type: "day-item", item },
    });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: transform
          ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
          : undefined,
        opacity: isDragging ? 0.65 : undefined,
      }}
      {...listeners}
      {...attributes}
    >
      {children}
    </div>
  );
}

function DayDrop({
  plan,
  children,
}: {
  plan: DayPlan & { day_items: DayItem[] };
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: plan.id });

  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-52 w-[300px] shrink-0 snap-start flex-col border p-3 ${
        isOver ? "border-zinc-950 bg-zinc-100" : "border-zinc-200 bg-white"
      }`}
    >
      {children}
    </div>
  );
}

export function DayPlanner({
  dayPlans,
  verifiedSpots,
  allSpots,
  hotel,
  city,
  arrivalDate,
  departureDate,
}: {
  dayPlans: Array<DayPlan & { day_items: DayItem[] }>;
  verifiedSpots: Spot[];
  allSpots: Spot[];
  hotel: { latitude: number | null; longitude: number | null } | null;
  city: string;
  arrivalDate: string | null;
  departureDate: string | null;
}) {
  const spotsById = new Map(allSpots.map((spot) => [spot.id, spot]));
  const sensors = useSensors(useSensor(PointerSensor));
  const [message, setMessage] = useState("");
  const [mealSuggestions, setMealSuggestions] = useState<
    Record<
      string,
      Array<{
        name: string;
        address: string;
        googleMapsUri: string | null;
        rating: number | null;
        userRatingCount: number | null;
      }>
    >
  >({});
  const [loadingMealId, setLoadingMealId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleDragEnd(event: DragEndEvent) {
    const data = event.active.data.current as
      | { type: "spot"; spot: Spot }
      | { type: "day-item"; item: DayItem }
      | undefined;
    const dayPlanId = event.over?.id;
    if (!data || typeof dayPlanId !== "string") return;

    const formData = new FormData();
    formData.set("day_plan_id", dayPlanId);

    if (data.type === "spot") {
      formData.set("spot_id", data.spot.id);
      formData.set("title", data.spot.name);
      formData.set("duration_minutes", String(data.spot.duration_minutes));
      startTransition(async () => {
        await addSpotToDay(formData);
        router.refresh();
      });
      return;
    }

    formData.set("day_item_id", data.item.id);
    startTransition(async () => {
      await moveDayItemToDay(formData);
      router.refresh();
    });
  }

  async function runSchedule(dayPlanId: string, mode: "optimize" | "recalculate") {
    setMessage("");
    const response = await fetch("/api/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dayPlanId, mode }),
    });
    const data = await response.json();
    const summary = data.ok
      ? data.warning ||
        (mode === "optimize" ? "Day auto-planned." : "Times recalculated.")
      : data.conflict ?? "Could not schedule day.";
    setMessage([summary, data.travelWarning].filter(Boolean).join(" "));
    router.refresh();
  }

  async function suggestMeals(item: DayItem) {
    setMessage("");
    setLoadingMealId(item.id);
    const meal = item.title.toLowerCase().includes("dinner") ? "Dinner" : "Lunch";
    try {
      const response = await fetch("/api/meals/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city, meal }),
      });
      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error ?? "Could not load meal suggestions.");
        return;
      }

      setMealSuggestions((current) => ({
        ...current,
        [item.id]: data.suggestions ?? [],
      }));
    } catch {
      setMessage("Could not load meal suggestions. Please try again.");
    } finally {
      setLoadingMealId(null);
    }
  }

  return (
    <DndContext id="day-planner-dnd" sensors={sensors} onDragEnd={handleDragEnd}>
      <section className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="border border-zinc-200 bg-zinc-50 p-3">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Verified spots
          </p>
          <div className="grid gap-2">
            {verifiedSpots.map((spot) => (
              <DraggableSpot
                key={spot.id}
                spot={spot}
                dayPlans={dayPlans}
                onAdded={() => router.refresh()}
              />
            ))}
            {!verifiedSpots.length ? (
              <p className="text-xs leading-5 text-zinc-500">
                All verified spots are already on a day.
              </p>
            ) : null}
          </div>
        </aside>
        <div className="grid gap-3">
          {message ? (
            <p className="border border-zinc-200 bg-white p-3 text-sm text-zinc-700">
              {message}
            </p>
          ) : null}
          <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-3">
          {dayPlans.map((plan) => {
            const sorted = [...plan.day_items].sort(
              (a, b) =>
                (a.start_time ?? "99:99").localeCompare(b.start_time ?? "99:99") ||
                a.sort_order - b.sort_order,
            );
            const dayIndex = dayPlans.findIndex((entry) => entry.id === plan.id);
            const orderedSpots = sorted
              .map((item) => (item.spot_id ? spotsById.get(item.spot_id) : undefined))
              .filter((spot): spot is Spot => Boolean(spot));
            const directionsUrl = buildDirectionsUrl({ spots: orderedSpots, hotel });
            const firstScheduledItem = sorted.find((item) => item.start_time);
            const dayStart = timeToMinutes(plan.start_time);
            const firstScheduledStart = firstScheduledItem?.start_time
              ? timeToMinutes(firstScheduledItem.start_time)
              : null;
            const hasOpeningBuffer =
              firstScheduledItem &&
              firstScheduledStart !== null &&
              firstScheduledStart > dayStart;
            return (
              <DayDrop key={plan.id} plan={plan}>
                <div className="grid gap-2">
                  <div>
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-950">
                      <span
                        className="inline-block h-3 w-3 shrink-0 rounded-full"
                        style={{ backgroundColor: dayColor(dayIndex) }}
                        aria-hidden
                      />
                      {formatDate(plan.plan_date)}
                    </h3>
                    {plan.plan_date === arrivalDate || plan.plan_date === departureDate ? (
                      <p className="mt-1 text-xs text-zinc-500">
                        {plan.plan_date === arrivalDate ? "Arrival day" : ""}
                        {plan.plan_date === arrivalDate && plan.plan_date === departureDate
                          ? " and "
                          : ""}
                        {plan.plan_date === departureDate ? "Departure day" : ""}
                      </p>
                    ) : null}
                  </div>
                  <form
                    action={updateDayPlanTimes}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <input type="hidden" name="day_plan_id" value={plan.id} />
                    <input
                      name="start_time"
                      type="time"
                      defaultValue={plan.start_time.slice(0, 5)}
                      className="h-8 border border-zinc-200 px-2 text-xs"
                      title="Day start time"
                    />
                    <span className="text-xs text-zinc-400">to</span>
                    <input
                      name="end_time"
                      type="time"
                      defaultValue={plan.end_time.slice(0, 5)}
                      className="h-8 border border-zinc-200 px-2 text-xs"
                      title="Day end time"
                    />
                    <SubmitButton pendingText="Saving..." className="h-8 border border-zinc-200 bg-white px-2 text-xs font-medium disabled:text-zinc-400">
                      Save hours
                    </SubmitButton>
                  </form>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        startTransition(() => runSchedule(plan.id, "recalculate"))
                      }
                      disabled={isPending}
                      title="Recalculate times, keeping the order you arranged"
                      className="inline-flex h-8 items-center gap-2 border border-zinc-200 bg-white px-3 text-xs font-medium disabled:text-zinc-400"
                    >
                      <Clock size={14} />
                      Retime, keep order
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        startTransition(() => runSchedule(plan.id, "optimize"))
                      }
                      disabled={isPending}
                      title="Reorder the day for the shortest travel time"
                      className="inline-flex h-8 items-center gap-2 bg-zinc-950 px-3 text-xs font-medium text-white disabled:bg-zinc-400"
                    >
                      <Route size={14} />
                      Auto-plan day
                    </button>
                    {directionsUrl ? (
                      <a
                        href={directionsUrl}
                        target="_blank"
                        rel="noreferrer"
                        title="Open this day's route in Google Maps"
                        className="inline-flex h-8 items-center gap-2 border border-zinc-200 bg-white px-3 text-xs font-medium hover:bg-zinc-100"
                      >
                        <Navigation size={14} />
                        Directions
                      </a>
                    ) : null}
                  </div>
                </div>
                <form
                  action={addAnchor}
                  className="mt-3 grid gap-2 sm:grid-cols-[1fr_96px_96px_auto]"
                >
                  <input type="hidden" name="day_plan_id" value={plan.id} />
                  <input
                    name="title"
                    required
                    minLength={2}
                    placeholder="Fixed anchor"
                    className="h-9 border border-zinc-200 px-2 text-sm"
                  />
                  <input
                    name="start_time"
                    type="time"
                    required
                    defaultValue="09:00"
                    className="h-9 border border-zinc-200 px-2 text-sm"
                  />
                  <input
                    name="end_time"
                    type="time"
                    required
                    defaultValue="10:00"
                    className="h-9 border border-zinc-200 px-2 text-sm"
                  />
                  <SubmitButton pendingText="Adding..." className="inline-flex h-9 items-center justify-center gap-1 border border-zinc-200 bg-white px-2 text-xs font-medium disabled:text-zinc-400">
                    <CalendarClock size={14} />
                    Add
                  </SubmitButton>
                </form>
                <div className="mt-4 grid gap-2">
                  {hasOpeningBuffer ? (
                    <div className="grid gap-3 border border-amber-200 bg-amber-50 p-3 sm:grid-cols-[104px_1fr_auto]">
                      <div className="text-xs font-medium text-amber-800">
                        {formatTime(plan.start_time)} -{" "}
                        {formatTime(firstScheduledItem.start_time)}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-amber-950">
                          Waiting buffer
                        </p>
                        <p className="mt-1 text-xs text-amber-800">
                          {firstScheduledItem.title} starts at{" "}
                          {formatTime(firstScheduledItem.start_time)} because the
                          day cannot be filled earlier with the current anchors and
                          opening hours.
                        </p>
                      </div>
                    </div>
                  ) : null}
                  {sorted.map((item) => (
                    <DraggableDayItem key={item.id} item={item}>
                      <div
                        className={`grid gap-3 border p-3 sm:grid-cols-[104px_1fr_auto] ${
                          getDisplayConflict(item)
                            ? "border-red-200 bg-red-50"
                            : "border-zinc-100 bg-zinc-50"
                        }`}
                      >
                      <div className="text-xs font-medium text-zinc-700">
                        {formatTime(item.start_time)}
                        {item.end_time ? ` - ${formatTime(item.end_time)}` : ""}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-zinc-950">{item.title}</p>
                        <p className="mt-1 text-xs text-zinc-500">
                          {item.item_type === "fixed_anchor"
                            ? item.schedule_mode === "meal" || isMealItem(item)
                              ? "Flexible meal"
                              : "Fixed anchor"
                            : `${item.duration_minutes} min`}
                          {item.travel_time_from_previous_minutes
                            ? item.travel_time_is_estimated
                              ? ` · ~${item.travel_time_from_previous_minutes} min from prior (estimated)`
                              : ` · ${item.travel_time_from_previous_minutes} min from prior`
                            : ""}
                        </p>
                        {item.item_type === "spot" ? (
                          <div
                            className="mt-2 grid gap-2"
                            onPointerDown={stopDragActivation}
                          >
                            <div className="flex items-center gap-1">
                              {(["up", "down"] as const).map((direction) => (
                                <form
                                  key={direction}
                                  action={async (formData) => {
                                    await moveDayItem(formData);
                                    // Times follow the order, the way a
                                    // spreadsheet row moves with its contents.
                                    await runSchedule(plan.id, "recalculate");
                                  }}
                                >
                                  <input
                                    type="hidden"
                                    name="day_item_id"
                                    value={item.id}
                                  />
                                  <input
                                    type="hidden"
                                    name="direction"
                                    value={direction}
                                  />
                                  <SubmitButton
                                    pendingText="..."
                                    title={
                                      direction === "up"
                                        ? "Move earlier in the day"
                                        : "Move later in the day"
                                    }
                                    className="inline-flex h-7 w-7 items-center justify-center border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100 disabled:text-zinc-300"
                                  >
                                    {direction === "up" ? (
                                      <ArrowUp size={13} />
                                    ) : (
                                      <ArrowDown size={13} />
                                    )}
                                  </SubmitButton>
                                </form>
                              ))}
                            </div>
                            <form
                              action={async (formData) => {
                                await updateDayItemDuration(formData);
                                router.refresh();
                              }}
                              className="flex flex-wrap items-center gap-2"
                            >
                              <input
                                type="hidden"
                                name="day_item_id"
                                value={item.id}
                              />
                              <input
                                name="duration_minutes"
                                type="number"
                                min={15}
                                step={15}
                                defaultValue={item.duration_minutes}
                                className="h-8 w-20 border border-zinc-200 px-2 text-xs"
                                title="Visit duration in minutes"
                              />
                              <SubmitButton pendingText="Saving..." className="h-8 border border-zinc-200 bg-white px-2 text-xs font-medium disabled:text-zinc-400">
                                Save time
                              </SubmitButton>
                            </form>
                            <form
                              action={async (formData) => {
                                await updateDayItemPlanning(formData);
                                router.refresh();
                              }}
                              className="flex flex-wrap items-center gap-2"
                            >
                              <input
                                type="hidden"
                                name="day_item_id"
                                value={item.id}
                              />
                              <select
                                name="schedule_mode"
                                defaultValue={item.schedule_mode ?? "auto"}
                                className="h-8 border border-zinc-200 px-2 text-xs"
                                title="Schedule mode"
                              >
                                <option value="auto">Auto</option>
                                <option value="pinned">Pinned</option>
                              </select>
                              <select
                                name="priority"
                                defaultValue={item.priority ?? "nice"}
                                className="h-8 border border-zinc-200 px-2 text-xs"
                                title="Priority"
                              >
                                <option value="must">Must</option>
                                <option value="nice">Nice</option>
                                <option value="maybe">Maybe</option>
                              </select>
                              <SubmitButton pendingText="Saving..." className="h-8 border border-zinc-200 bg-white px-2 text-xs font-medium disabled:text-zinc-400">
                                Save planning
                              </SubmitButton>
                            </form>
                          </div>
                        ) : null}
                        {isMealItem(item) ? (
                          <div
                            className="mt-2 grid gap-2"
                            onPointerDown={stopDragActivation}
                          >
                            <button
                              type="button"
                              onClick={() => suggestMeals(item)}
                              disabled={loadingMealId === item.id}
                              className="h-8 justify-self-start border border-zinc-200 bg-white px-2 text-xs font-medium disabled:text-zinc-400"
                            >
                              {loadingMealId === item.id ? "Finding options..." : "Suggest nearby"}
                            </button>
                            {(mealSuggestions[item.id] ?? []).map((suggestion) => (
                              <form
                                key={`${item.id}-${suggestion.name}`}
                                action={async (formData) => {
                                  await updateDayItemTitle(formData);
                                  router.refresh();
                                }}
                                className="flex items-start justify-between gap-2 border border-zinc-100 bg-white p-2"
                              >
                                <input
                                  type="hidden"
                                  name="day_item_id"
                                  value={item.id}
                                />
                                <input
                                  type="hidden"
                                  name="title"
                                  value={`${item.title.split(" - ")[0]} - ${suggestion.name}`}
                                />
                                <div>
                                  <p className="text-xs font-medium text-zinc-950">
                                    {suggestion.name}
                                  </p>
                                  <p className="mt-1 text-xs text-zinc-500">
                                    {suggestion.address}
                                    {suggestion.rating
                                      ? ` - Google ${suggestion.rating.toFixed(1)}/5`
                                      : ""}
                                    {suggestion.userRatingCount
                                      ? ` (${suggestion.userRatingCount.toLocaleString()} reviews)`
                                      : ""}
                                  </p>
                                  {suggestion.googleMapsUri ? (
                                    <a
                                      href={suggestion.googleMapsUri}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="mt-1 inline-block text-xs font-medium text-zinc-950 underline"
                                      onClick={(event) => event.stopPropagation()}
                                    >
                                      Open Google Maps
                                    </a>
                                  ) : null}
                                </div>
                                <SubmitButton pendingText="Saving..." className="h-7 border border-zinc-200 bg-white px-2 text-xs font-medium disabled:text-zinc-400">
                                  Use
                                </SubmitButton>
                              </form>
                            ))}
                            <form
                              action={async (formData) => {
                                const mealName = String(formData.get("meal_name") ?? "").trim();
                                if (!mealName) return;
                                formData.set(
                                  "title",
                                  `${item.title.split(" - ")[0]} - ${mealName}`,
                                );
                                await updateDayItemTitle(formData);
                                router.refresh();
                              }}
                              className="flex flex-wrap items-center gap-2"
                            >
                              <input
                                type="hidden"
                                name="day_item_id"
                                value={item.id}
                              />
                              <input
                                name="meal_name"
                                required
                                placeholder="Enter restaurant or meal"
                                defaultValue={item.title.split(" - ").slice(1).join(" - ")}
                                className="h-8 min-w-0 flex-1 border border-zinc-200 bg-white px-2 text-xs"
                              />
                              <SubmitButton
                                pendingText="Saving..."
                                className="h-8 border border-zinc-200 bg-white px-2 text-xs font-medium disabled:text-zinc-400"
                              >
                                Save manually
                              </SubmitButton>
                            </form>
                          </div>
                        ) : null}
                        {getDisplayConflict(item) ? (
                          <p className="mt-1 text-xs text-red-700">
                            {getDisplayConflict(item)}
                          </p>
                        ) : null}
                      </div>
                      <form action={removeDayItem} onPointerDown={stopDragActivation}>
                        <input type="hidden" name="day_item_id" value={item.id} />
                        <button
                          title="Remove item"
                          className="inline-flex h-8 w-8 items-center justify-center border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-100"
                        >
                          <Trash2 size={14} />
                        </button>
                      </form>
                      </div>
                    </DraggableDayItem>
                  ))}
                </div>
              </DayDrop>
            );
          })}
          </div>
        </div>
      </section>
    </DndContext>
  );
}
