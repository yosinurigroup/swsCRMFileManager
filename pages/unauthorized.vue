<template>
  <div class="h-screen flex items-center justify-center" style="background:var(--surface-primary)">
    <div class="max-w-md w-full mx-4 text-center">
      <!-- Shield icon -->
      <div class="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-6" style="background:rgba(239,68,68,0.1)">
        <svg class="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </div>

      <h1 class="text-2xl font-bold mb-2" style="color:var(--text-primary)">Unauthorized Access</h1>
      <p class="text-sm mb-6" style="color:var(--text-secondary)">
        This link has expired or you don't have permission to access this resource.
        Please use the original link from your application to open the file manager.
      </p>

      <div class="p-4 rounded-xl mb-6" style="background:var(--surface-card);border:1px solid var(--border-subtle)">
        <div class="flex items-center gap-3 text-left">
          <div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style="background:rgba(245,158,11,0.1)">
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </div>
          <div>
            <p class="text-sm font-semibold" style="color:var(--text-primary)">Why am I seeing this?</p>
            <p class="text-xs mt-0.5" style="color:var(--text-tertiary)">
              Secure links are single-session only. They cannot be copied, shared, or reopened in another browser.
            </p>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-2 justify-center text-xs" style="color:var(--text-tertiary)">
        <div class="w-1.5 h-1.5 rounded-full" style="background:#ef4444"></div>
        SWS CRM File Manager · Protected Access
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
useHead({ title: 'Unauthorized - SWS File Manager' })
</script>
