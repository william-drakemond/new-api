/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useQuery } from '@tanstack/react-query'
import { Gauge, RotateCw, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { IconBadge } from '@/components/ui/icon-badge'
import { Progress } from '@/components/ui/progress'
import { getUpstreamUsage } from '@/features/dashboard/api'
import type {
  UpstreamUsageGroup,
  UpstreamUsageWindow,
} from '@/features/dashboard/types'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { requireServerSuccess } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

import { PanelWrapper } from '../ui/panel-wrapper'

const UPSTREAM_USAGE_REFRESH_MS = 60 * 1000

const WINDOW_LABEL_KEYS: Record<string, string> = {
  '5h': '5 hours',
  '1d': 'Daily',
  '7d': 'Weekly',
}

function usageColor(percent: number): string {
  if (percent >= 100) return 'text-rose-500'
  if (percent >= 80) return 'text-amber-500'
  return 'text-emerald-500'
}

// Time until a reset in two units, rounded down: "in 6 days 18 hours", "6天18小时后". The upstream
// gateway's usage page shows it this way; formatTimestampRelative keeps one unit and rounds, so a
// week with 6 days 18 hours left read "in 7 days". The "in …" wrapper is taken from
// Intl.RelativeTimeFormat, so each locale keeps its own word order.
export function formatResetIn(
  resetsAt: number,
  now: number,
  locale?: Intl.LocalesArgument
): string {
  const remaining = resetsAt - now
  if (remaining <= 0) {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(0, 'second')
  }
  // Under a minute still reads "in 1 minute", not "in 0 minutes".
  const totalMinutes = Math.max(1, Math.floor(remaining / 60_000))
  // numeric 'always': with 'auto', 1 day is the word "tomorrow" and has no number to replace.
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'always' })
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  const units: [number, 'day' | 'hour' | 'minute'][] =
    days > 0 ? [[days, 'day'], [hours, 'hour']] : hours > 0 ? [[hours, 'hour'], [minutes, 'minute']] : [[minutes, 'minute']]
  const parts = units
    .filter(([value], index) => index === 0 || value > 0)
    .map(([value, unit]) =>
      new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'long' }).format(value)
    )
  // CJK units read without spaces ("6天18小时"); Intl adds one inside some of them ("6 天"), so
  // drop it there too. Other scripts separate the parts with one space.
  const cjk = /^(zh|ja|ko)/i.test(String(locale ?? ''))
  const joined = cjk ? parts.map((part) => part.replace(/\s+/g, '')).join('') : parts.join(' ')
  // Wrap with the locale's own "in N units" pattern: format 1 of the first unit and swap the phrase.
  const sample = relative.formatToParts(1, units[0][1])
  const number = sample.findIndex((part) => part.type === 'integer')
  if (number < 0) {
    return joined
  }
  const before = sample.slice(0, number).map((part) => part.value).join('')
  const after = sample.slice(number + 1).map((part) => part.value).join('')
  // The unit word follows the number inside the pattern; drop it, the joined text has its own.
  const unitWord = new Intl.NumberFormat(locale, { style: 'unit', unit: units[0][1], unitDisplay: 'long' })
    .formatToParts(1)
    .filter((part) => part.type === 'unit')
    .map((part) => part.value)[0]
  const tail = unitWord && after.trimStart().startsWith(unitWord) ? after.trimStart().slice(unitWord.length) : after
  return cjk ? `${before.trim()}${joined}${tail.trim()}` : `${before}${joined}${tail}`
}

function UsageWindowRow(props: { group: string; window: UpstreamUsageWindow }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const percent = Math.min(100, Math.max(0, props.window.percent))
  const labelKey = WINDOW_LABEL_KEYS[props.window.window]
  const label = labelKey ? t(labelKey) : props.window.window
  const resetsAt = props.window.resets_at
    ? Date.parse(props.window.resets_at)
    : Number.NaN

  return (
    <div className='flex flex-col gap-1.5'>
      <div className='flex items-center justify-between gap-3 text-sm'>
        <span className='text-muted-foreground'>{label}</span>
        <span className='font-mono font-semibold tabular-nums'>
          {formatNumber(Math.round(percent), locale)}%
        </span>
      </div>
      <Progress
        value={percent}
        aria-label={`${props.group} ${label}`}
        className={cn(
          '[&_[data-slot=progress-indicator]]:bg-current',
          usageColor(percent)
        )}
      />
      <span
        className='text-muted-foreground text-xs'
        title={
          Number.isNaN(resetsAt)
            ? undefined
            : new Date(resetsAt).toLocaleString(locale)
        }
      >
        {Number.isNaN(resetsAt)
          ? t('Starts with the next request')
          : t('Resets {{time}}', {
              time: formatResetIn(resetsAt, Date.now(), locale),
            })}
      </span>
    </div>
  )
}

function UsageGroup(props: { group: UpstreamUsageGroup }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const name = props.group.name || props.group.channel
  const lockedUntil = props.group.locked_until
    ? Date.parse(props.group.locked_until)
    : Number.NaN

  return (
    <section className='flex flex-col gap-3' aria-label={name}>
      <h4 className='text-muted-foreground text-xs font-semibold tracking-wider uppercase'>
        {name}
      </h4>
      {props.group.error || !props.group.windows ? (
        <p className='text-muted-foreground text-sm'>
          {t('Upstream quota is unavailable')}
        </p>
      ) : (
        props.group.windows.map((window) => (
          <UsageWindowRow key={window.window} group={name} window={window} />
        ))
      )}
      {!Number.isNaN(lockedUntil) && (
        <p className='text-destructive flex items-start gap-1.5 text-xs'>
          <TriangleAlert
            className='mt-px size-3.5 shrink-0'
            aria-hidden='true'
          />
          {t('Locked by the provider until {{time}}', {
            time: new Date(lockedUntil).toLocaleString(locale, {
              month: 'numeric',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            }),
          })}
        </p>
      )}
    </section>
  )
}

export function UpstreamUsagePanel(props: { className?: string }) {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: ['dashboard', 'overview', 'upstream-usage'],
    queryFn: async () => requireServerSuccess(await getUpstreamUsage()).data,
    refetchInterval: UPSTREAM_USAGE_REFRESH_MS,
    meta: { errorToast: false },
  })
  const groups = query.data?.groups ?? []

  return (
    <PanelWrapper
      title={
        <span className='flex items-center gap-2'>
          <IconBadge tone='warning' size='sm'>
            <Gauge />
          </IconBadge>
          {t('Upstream quota')}
        </span>
      }
      description={t('Share of the upstream spending limits in use')}
      loading={query.isLoading}
      empty={!groups.length}
      emptyMessage={
        query.isError
          ? t('Upstream quota is unavailable')
          : t('No upstream quota configured')
      }
      height='h-40'
      className={props.className}
      headerActions={
        <Button
          variant='ghost'
          size='sm'
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
          className='size-7 p-0'
          aria-label={t('Refresh')}
        >
          <RotateCw
            className={cn('size-3.5', query.isFetching && 'animate-spin')}
            aria-hidden='true'
          />
        </Button>
      }
    >
      <div className='flex flex-col gap-5'>
        {groups.map((group) => (
          <UsageGroup key={group.channel} group={group} />
        ))}
      </div>
    </PanelWrapper>
  )
}
