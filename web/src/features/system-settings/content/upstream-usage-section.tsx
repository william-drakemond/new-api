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
import { zodResolver } from '@hookform/resolvers/zod'
import type { TFunction } from 'i18next'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

const ENABLED_KEY = 'console_setting.upstream_usage_enabled'
const URL_KEY = 'console_setting.upstream_usage_url'

function isHttpUrl(value: string): boolean {
  if (!URL.canParse(value)) return false
  const url = new URL(value)
  return (
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    !url.username &&
    !url.password
  )
}

const createUpstreamUsageSchema = (t: TFunction) =>
  z
    .object({
      enabled: z.boolean(),
      url: z
        .string()
        .trim()
        .refine((value) => value === '' || isHttpUrl(value), {
          error: t(
            'Upstream quota URL must be an http or https URL without credentials'
          ),
        }),
    })
    .refine((values) => !values.enabled || values.url !== '', {
      path: ['url'],
      error: t('Enter the upstream quota URL to show the panel'),
    })

type UpstreamUsageFormValues = z.infer<
  ReturnType<typeof createUpstreamUsageSchema>
>

type UpstreamUsageSectionProps = {
  enabled: boolean
  url: string
}

export function UpstreamUsageSection(props: UpstreamUsageSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const form = useForm<UpstreamUsageFormValues>({
    resolver: zodResolver(createUpstreamUsageSchema(t)),
    defaultValues: { enabled: props.enabled, url: props.url },
  })

  useEffect(() => {
    form.reset({ enabled: props.enabled, url: props.url })
  }, [props.enabled, props.url, form])

  const onSubmit = async (values: UpstreamUsageFormValues) => {
    // The URL first: the server validates it, and the panel turns on only after it is saved.
    if (values.url !== props.url) {
      await updateOption.mutateAsync({ key: URL_KEY, value: values.url })
    }
    if (values.enabled !== props.enabled) {
      await updateOption.mutateAsync({
        key: ENABLED_KEY,
        value: values.enabled,
      })
    }
  }

  const isEnabled = form.watch('enabled')

  return (
    <SettingsSection title={t('Upstream Quota')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
          />
          <FormField
            control={form.control}
            name='enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>
                    {t('Show upstream quota on the overview')}
                  </FormLabel>
                  <FormDescription>
                    {t(
                      'Signed-in users see how much of each upstream spending limit is in use and when it resets.'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />
          <FormField
            control={form.control}
            name='url'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Upstream quota URL')}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type='url'
                    inputMode='url'
                    autoComplete='off'
                    placeholder='http://gateway:4000/usage/name/data'
                    disabled={!isEnabled}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'The data address of the upstream gateway usage page. The server fetches it; browsers never contact it.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
