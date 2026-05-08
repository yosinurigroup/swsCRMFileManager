import { BigQuery } from '@google-cloud/bigquery'

let _bq: BigQuery | null = null

export function useBigQuery(): BigQuery {
  if (_bq) return _bq

  const config = useRuntimeConfig()
  const { projectId, clientEmail, privateKey } = config.bigquery

  _bq = new BigQuery({
    projectId,
    credentials: {
      client_email: clientEmail,
      private_key: (privateKey || '').replace(/\\n/g, '\n'),
    },
  })

  return _bq
}

export function getDataset(): string {
  return useRuntimeConfig().bigquery.dataset || 'SWSCRMV4'
}
