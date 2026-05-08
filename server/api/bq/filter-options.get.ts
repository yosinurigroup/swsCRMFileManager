export default defineEventHandler(async () => {
  try {
    const bq = useBigQuery()
    const dataset = getDataset()

    const sql = `
      SELECT
        ARRAY_AGG(DISTINCT \`Branch Name\` IGNORE NULLS ORDER BY \`Branch Name\`) AS branches,
        ARRAY_AGG(DISTINCT \`Vendor\` IGNORE NULLS ORDER BY \`Vendor\`) AS vendors,
        ARRAY_AGG(DISTINCT \`Sales Rep\` IGNORE NULLS ORDER BY \`Sales Rep\`) AS salesReps,
        ARRAY_AGG(DISTINCT \`Project Type\` IGNORE NULLS ORDER BY \`Project Type\`) AS projectTypes,
        ARRAY_AGG(DISTINCT \`Job Status\` IGNORE NULLS ORDER BY \`Job Status\`) AS jobStatuses,
        ARRAY_AGG(DISTINCT \`Project Status\` IGNORE NULLS ORDER BY \`Project Status\`) AS projectStatuses,
        ARRAY_AGG(DISTINCT \`Project Manager\` IGNORE NULLS ORDER BY \`Project Manager\`) AS projectManagers,
        ARRAY_AGG(DISTINCT \`Finance Manager\` IGNORE NULLS ORDER BY \`Finance Manager\`) AS financeManagers,
        ARRAY_AGG(DISTINCT \`Engineer\` IGNORE NULLS ORDER BY \`Engineer\`) AS engineers,
        ARRAY_AGG(DISTINCT \`Permit Coordinator\` IGNORE NULLS ORDER BY \`Permit Coordinator\`) AS permitCoordinators,
        ARRAY_AGG(DISTINCT \`Utillity\` IGNORE NULLS ORDER BY \`Utillity\`) AS utilities,
        ARRAY_AGG(DISTINCT \`Solar Equipment\` IGNORE NULLS ORDER BY \`Solar Equipment\`) AS solarEquipment,
        ARRAY_AGG(DISTINCT \`SSA Status\` IGNORE NULLS ORDER BY \`SSA Status\`) AS ssaStatuses,
        ARRAY_AGG(DISTINCT \`Solar Install Status\` IGNORE NULLS ORDER BY \`Solar Install Status\`) AS solarInstallStatuses,
        ARRAY_AGG(DISTINCT \`Completion Status\` IGNORE NULLS ORDER BY \`Completion Status\`) AS completionStatuses,
        ARRAY_AGG(DISTINCT \`Final Status\` IGNORE NULLS ORDER BY \`Final Status\`) AS finalStatuses
      FROM \`${dataset}.Projects\`
      WHERE (TempDeleted IS NULL OR TempDeleted != true)
    `

    const [rows] = await bq.query({ query: sql })
    const result = rows?.[0] || {}

    // Title Case helper: "PENDING COMPLETION" → "Pending Completion"
    function titleCase(str: string): string {
      return str.toLowerCase().replace(/(?:^|\s)\S/g, (c) => c.toUpperCase())
    }

    // Split comma/slash separated fields into unique, title-cased values
    function splitUnique(arr: string[]): string[] {
      const map = new Map<string, string>() // lowercase key → title-cased value
      for (const val of arr) {
        if (!val) continue
        // Split on comma or " / " (space-slash-space) but NOT bare "/" like in "T/S"
        const parts = val.split(/\s*,\s*|\s+\/\s+/)
        for (const p of parts) {
          const trimmed = p.trim()
          if (!trimmed) continue
          const key = trimmed.toLowerCase()
          if (!map.has(key)) map.set(key, titleCase(trimmed))
        }
      }
      return [...map.values()].sort((a, b) => a.localeCompare(b))
    }

    // Capitalize non-split arrays
    function capitalizeUnique(arr: string[]): string[] {
      const map = new Map<string, string>()
      for (const val of arr) {
        if (!val) continue
        const key = val.trim().toLowerCase()
        if (!key) continue
        if (!map.has(key)) map.set(key, titleCase(val.trim()))
      }
      return [...map.values()].sort((a, b) => a.localeCompare(b))
    }

    return {
      branches: capitalizeUnique(result.branches || []),
      vendors: capitalizeUnique(result.vendors || []),
      salesReps: result.salesReps || [],
      projectTypes: capitalizeUnique(result.projectTypes || []),
      jobStatuses: splitUnique(result.jobStatuses || []),
      projectStatuses: splitUnique(result.projectStatuses || []),
      projectManagers: result.projectManagers || [],
      financeManagers: result.financeManagers || [],
      engineers: result.engineers || [],
      permitCoordinators: result.permitCoordinators || [],
      utilities: capitalizeUnique(result.utilities || []),
      solarEquipment: capitalizeUnique(result.solarEquipment || []),
      ssaStatuses: splitUnique(result.ssaStatuses || []),
      solarInstallStatuses: splitUnique(result.solarInstallStatuses || []),
      completionStatuses: splitUnique(result.completionStatuses || []),
      finalStatuses: splitUnique(result.finalStatuses || []),
    }
  } catch (err: any) {
    console.error('BigQuery filter-options error:', err)
    throw createError({
      statusCode: 500,
      statusMessage: err.message || 'Failed to fetch filter options',
    })
  }
})
