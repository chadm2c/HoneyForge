import type { ReactNode } from "react";
import ConnectionBadge from "../components/ConnectionBadge";
import EventsOverTimeChart from "../components/EventsOverTimeChart";
import EmptyState from "../components/ui/EmptyState";
import ErrorState from "../components/ui/ErrorState";
import LoadingText from "../components/ui/LoadingText";
import Panel from "../components/ui/Panel";
import Table, { Td, Th } from "../components/ui/Table";
import { useOverviewData } from "../hooks/useOverviewData";
import type { Overview } from "../lib/stats";

// The wording is verbatim (spec §7.5) so the empty state can never drift from
// the "truncated sample" disclosure that says something else.
const EMPTY_EVENTS = "no events in the last 24h";

/**
 * One events-governed panel body. The two requests drive their own sections
 * independently: loading, a genuine error, a genuine empty and the content are
 * four distinct states, so a failed request is never rendered as a zero.
 */
function EventsBody({
  loading,
  error,
  overview,
  empty,
  children,
}: {
  loading: boolean;
  error: string | null;
  overview: Overview | null;
  empty: boolean;
  children: (overview: Overview) => ReactNode;
}) {
  if (loading) return <LoadingText className="mt-2" />;
  if (error) return <ErrorState className="mt-2">{error}</ErrorState>;
  if (!overview) return null;
  if (empty) return <EmptyState className="mt-2">{EMPTY_EVENTS}</EmptyState>;
  return <>{children(overview)}</>;
}

export default function OverviewPage() {
  const {
    overview,
    fleetCounts,
    fleetLoading,
    fleetError,
    eventsLoading,
    eventsError,
    status,
    recovery,
  } = useOverviewData();

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ConnectionBadge status={status} />
          {/* Recovery completeness is a separate axis from the socket status:
              the badge stays "live" and this muted note carries the gap. */}
          {recovery === "capped" && (
            <span className="text-xs text-slate-500">
              {`history is partial — recovered the most recent ${
                overview?.inWindowCount ?? 0
              } events`}
            </span>
          )}
          {recovery === "failed" && (
            <span className="text-xs text-slate-500">
              history could not be recovered
            </span>
          )}
        </div>
        {/* The disclosure is governed by the events request (§7.5): loading is a
            placeholder and a failure is an error, never a silent absence. */}
        {eventsLoading ? (
          <LoadingText />
        ) : eventsError ? (
          <ErrorState>{eventsError}</ErrorState>
        ) : (
          // Rendered verbatim from the derivation; never recomposed here.
          overview && (
            <p className="text-xs text-slate-500">{overview.disclosure.text}</p>
          )
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Panel title="Fleet">
          {fleetLoading ? (
            <LoadingText className="mt-2" />
          ) : fleetError ? (
            <ErrorState className="mt-2">{fleetError}</ErrorState>
          ) : fleetCounts ? (
            <>
              <p className="mt-1 text-2xl font-semibold text-slate-100">
                {fleetCounts.total}
              </p>
              <p className="text-xs text-slate-400">
                {`${fleetCounts.online} online · ${fleetCounts.offline} offline · ${fleetCounts.never} never`}
              </p>
            </>
          ) : null}
        </Panel>

        <Panel title="Events in window">
          <EventsBody
            loading={eventsLoading}
            error={eventsError}
            overview={overview}
            empty={overview?.inWindowCount === 0}
          >
            {(data) => (
              <p className="mt-1 text-2xl font-semibold text-slate-100">
                {data.inWindowCount}
              </p>
            )}
          </EventsBody>
        </Panel>

        <Panel title="Distinct sources">
          <EventsBody
            loading={eventsLoading}
            error={eventsError}
            overview={overview}
            empty={overview?.inWindowCount === 0}
          >
            {(data) => (
              <>
                <p className="mt-1 text-2xl font-semibold text-slate-100">
                  {data.distinctSources}
                </p>
                {data.unattributed > 0 && (
                  <p className="text-xs text-slate-500">
                    {`(${data.unattributed} unattributed)`}
                  </p>
                )}
              </>
            )}
          </EventsBody>
        </Panel>
      </div>

      <Panel title="Events over time">
        <EventsBody
          loading={eventsLoading}
          error={eventsError}
          overview={overview}
          empty={overview?.inWindowCount === 0}
        >
          {(data) => (
            <div className="mt-2">
              <EventsOverTimeChart
                buckets={data.buckets}
                disclosure={data.disclosure}
              />
            </div>
          )}
        </EventsBody>
      </Panel>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Panel title="Top event types">
          <EventsBody
            loading={eventsLoading}
            error={eventsError}
            overview={overview}
            empty={overview?.topTypes.length === 0}
          >
            {(data) => (
              <div className="mt-2">
                <Table>
                  <thead>
                    <tr>
                      <Th>Type</Th>
                      <Th>Events</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topTypes.map((row) => (
                      <tr key={row.key}>
                        <Td className="text-slate-300">{row.key}</Td>
                        <Td className="text-slate-300">{row.count}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </EventsBody>
        </Panel>

        <Panel title="Top targeted ports">
          <EventsBody
            loading={eventsLoading}
            error={eventsError}
            overview={overview}
            empty={overview?.topPorts.length === 0}
          >
            {(data) => (
              <div className="mt-2">
                <Table>
                  <thead>
                    <tr>
                      <Th>Port</Th>
                      <Th>Events</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topPorts.map((row) => (
                      <tr key={row.key}>
                        <Td className="text-slate-300">{row.key}</Td>
                        <Td className="text-slate-300">{row.count}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </EventsBody>
        </Panel>
      </div>
    </section>
  );
}
