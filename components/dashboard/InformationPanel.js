"use client";

import { formatBirthday } from "@/lib/format";

function NewsCard({ title, body, date }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4">
      <p className="font-semibold text-[#162338]">{title}</p>
      {date ? <p className="mt-1 text-xs text-slate-500">{date}</p> : null}
      <p className="mt-3 text-sm text-slate-600">{body}</p>
    </div>
  );
}

export default function InformationPanel({ highlights, birthdays, siteContent }) {
  const announcements = siteContent?.announcements ?? [];
  const newsItems = siteContent?.newsItems ?? [];
  const hasRecognition = highlights?.staffOfWeek?.name || highlights?.staffOfMonth?.name;

  return (
    <div className="space-y-6">
      {hasRecognition ? (
        <section className="panel p-6">
          <h2 className="section-title">Recognition</h2>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {highlights.staffOfWeek?.name ? (
              <div className="rounded-[28px] bg-[#162338] p-6 text-white">
                <p className="metric-label !text-[#e8d39b]">Staff of the Week</p>
                <h3 className="mt-3 font-display text-3xl">{highlights.staffOfWeek.name}</h3>
                <p className="mt-2 text-sm text-[#d7e4ef]">{highlights.staffOfWeek.department}</p>
              </div>
            ) : null}

            {highlights.staffOfMonth?.name ? (
              <div className="rounded-[28px] bg-[#f6edd7] p-6 text-[#162338]">
                <p className="metric-label">Staff of the Month</p>
                <h3 className="mt-3 font-display text-3xl">{highlights.staffOfMonth.name}</h3>
                <p className="mt-2 text-sm text-[#8a6923]">{highlights.staffOfMonth.department}</p>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="panel p-6">
        <h2 className="section-title">News and Announcements</h2>

        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          <div className="space-y-3">
            <p className="metric-label">Announcements</p>
            {announcements.length > 0 ? (
              announcements.map((announcement, index) => (
                <NewsCard
                  key={announcement.id ?? `announcement-${index + 1}`}
                  title={announcement.title || "Announcement"}
                  body={announcement.body || ""}
                  date={announcement.date || ""}
                />
              ))
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-500">
                No announcements yet.
              </div>
            )}
          </div>

          <div className="space-y-3">
            <p className="metric-label">Hotel news</p>
            {newsItems.length > 0 ? (
              newsItems.map((newsItem, index) => (
                <NewsCard
                  key={newsItem.id ?? `news-${index + 1}`}
                  title={newsItem.title || "Hotel news"}
                  body={newsItem.body || ""}
                  date={newsItem.date || ""}
                />
              ))
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-500">
                No hotel news yet.
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="panel p-6">
        <h2 className="section-title">Birthdays</h2>
        <div className="mt-5 space-y-3">
          {birthdays.length > 0 ? (
            birthdays.map((birthday) => (
              <div
                key={birthday.id}
                className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4"
              >
                <div>
                  <p className="font-semibold text-[#162338]">{birthday.name}</p>
                  <p className="mt-1 text-sm text-slate-500">{birthday.department}</p>
                </div>
                <div className="text-right">
                  <p className="font-medium text-[#8a6923]">{formatBirthday(birthday.date)}</p>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-500">
              No birthdays added yet.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
