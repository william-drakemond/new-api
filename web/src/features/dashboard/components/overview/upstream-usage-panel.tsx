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
import { formatNumber, formatTimestampRelative } from '@/lib/format'
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
              time: formatTimestampRelative(resetsAt, 'milliseconds', locale),
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
