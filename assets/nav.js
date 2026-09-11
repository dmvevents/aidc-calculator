/**
 * nav.js — Material-3-style responsive drawer navigation
 * Zero dependencies, vanilla JS, tokens.css palette only
 * ARIA accessible, keyboard navigation, prefers-reduced-motion
 */

(function() {
  'use strict';

  // Page manifest organized into collapsible groups
  const NAV_MANIFEST = [
    {
      title: 'Overview / Journey',
      pages: [
        { title: 'Overview', href: 'index.html' },
        { title: 'Journey', href: 'journey.html' },
        { title: 'Plan', href: 'plan.html' }
      ]
    },
    {
      title: 'Power + Cooling',
      pages: [
        { title: 'Power', href: 'power.html' },
        { title: 'Cooling', href: 'cooling.html' }
      ]
    },
    {
      title: 'Racks + 3D',
      pages: [
        { title: 'Racks', href: 'rack.html' },
        { title: '3D', href: '3d.html' }
      ]
    },
    {
      title: 'Land + Site + Geotech + Stormwater + Entitlements',
      pages: [
        { title: 'Land', href: 'land.html' },
        { title: 'Land dev', href: 'landdev.html' },
        { title: 'Site score', href: 'sitescore.html' },
        { title: 'Geotech', href: 'geotech.html' },
        { title: 'Stormwater', href: 'stormwater.html' },
        { title: 'Entitlements', href: 'entitlements.html' }
      ]
    },
    {
      title: 'Capex + TCO + Costctl + Invest + Colo + Neocloud',
      pages: [
        { title: 'Capex', href: 'capex.html' },
        { title: 'TCO', href: 'tco.html' },
        { title: 'Cost control', href: 'costctl.html' },
        { title: 'Invest', href: 'invest.html' },
        { title: 'Colo', href: 'colo.html' },
        { title: 'Neocloud', href: 'neocloud.html' }
      ]
    },
    {
      title: 'Fiber + Interconnect',
      pages: [
        { title: 'Fiber', href: 'fiber.html' },
        { title: 'Fiber layout', href: 'fiber-layout.html' },
        { title: 'Interconnect', href: 'interconnect.html' }
      ]
    },
    {
      title: 'Commissioning + Designs',
      pages: [
        { title: 'Commissioning', href: 'commissioning.html' },
        { title: 'Designs', href: 'designs.html' },
        { title: 'Topology', href: 'topology-designer.html' },
        { title: 'Risks', href: 'risks.html' }
      ]
    },
    {
      title: 'Sources',
      pages: [
        { title: 'Sources', href: 'sources.html' }
      ]
    }
  ];

  // Get current page filename
  function getCurrentPage() {
    const path = window.location.pathname;
    const filename = path.split('/').pop() || 'index.html';
    return filename === '' ? 'index.html' : filename;
  }

  // Build drawer HTML
  function buildDrawerHTML() {
    const currentPage = getCurrentPage();
    let html = '';

    NAV_MANIFEST.forEach((group, groupIndex) => {
      const groupId = `nav-group-${groupIndex}`;
      const isExpanded = group.pages.some(p => p.href === currentPage);

      html += `
        <div class="nav-drawer-group">
          <button
            class="nav-drawer-group-toggle"
            aria-expanded="${isExpanded}"
            aria-controls="${groupId}"
            data-group="${groupIndex}">
            <span class="nav-drawer-group-title">${group.title}</span>
            <svg class="nav-drawer-group-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
          <div class="nav-drawer-group-items ${isExpanded ? 'is-expanded' : ''}" id="${groupId}">
      `;

      group.pages.forEach(page => {
        const isActive = page.href === currentPage;
        html += `
            <a
              href="${page.href}"
              class="nav-drawer-item${isActive ? ' is-active' : ''}"
              ${isActive ? 'aria-current="page"' : ''}>
              ${page.title}
            </a>
        `;
      });

      html += `
          </div>
        </div>
      `;
    });

    return html;
  }

  // Type-to-filter functionality
  function filterPages(query) {
    const lowerQuery = query.toLowerCase().trim();
    const allItems = document.querySelectorAll('.nav-drawer-item');
    const allGroups = document.querySelectorAll('.nav-drawer-group');

    if (!lowerQuery) {
      // Show all
      allItems.forEach(item => item.style.display = '');
      allGroups.forEach(group => group.style.display = '');
      return;
    }

    allGroups.forEach(group => {
      const items = group.querySelectorAll('.nav-drawer-item');
      let hasVisibleItem = false;

      items.forEach(item => {
        const title = item.textContent.toLowerCase();
        if (title.includes(lowerQuery)) {
          item.style.display = '';
          hasVisibleItem = true;
        } else {
          item.style.display = 'none';
        }
      });

      group.style.display = hasVisibleItem ? '' : 'none';
    });
  }

  // Initialize drawer
  function initDrawer() {
    // Build and inject drawer
    const drawerHTML = `
      <div class="nav-drawer-overlay" id="navDrawerOverlay" aria-hidden="true"></div>
      <aside class="nav-drawer" id="navDrawer" aria-label="Site navigation">
        <div class="nav-drawer-header">
          <div class="nav-drawer-brand">
            <img src="assets/img/favicon.svg" alt="" width="24" height="24">
            <span>AI-DC CALC</span>
          </div>
          <button
            class="nav-drawer-close"
            id="navDrawerClose"
            aria-label="Close navigation">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div class="nav-drawer-filter">
          <input
            type="text"
            class="nav-drawer-filter-input"
            id="navDrawerFilter"
            placeholder="Type to filter..."
            aria-label="Filter pages">
        </div>
        <nav class="nav-drawer-content">
          ${buildDrawerHTML()}
        </nav>
      </aside>
    `;

    // Inject into body
    document.body.insertAdjacentHTML('afterbegin', drawerHTML);

    // Build slim header with hamburger
    const headerHTML = `
      <header class="nav-header">
        <button
          class="nav-hamburger"
          id="navHamburger"
          aria-label="Open navigation"
          aria-expanded="false"
          aria-controls="navDrawer">
          <span></span>
          <span></span>
          <span></span>
        </button>
        <div class="nav-header-brand">
          <img src="assets/img/favicon.svg" alt="" width="22" height="22">
          <span>AI-DC CALC</span>
        </div>
      </header>
    `;

    // Find where to insert header (before first .wrap or at start of body)
    const firstWrap = document.querySelector('.wrap');
    if (firstWrap) {
      firstWrap.insertAdjacentHTML('beforebegin', headerHTML);
    } else {
      document.body.insertAdjacentHTML('afterbegin', headerHTML);
    }

    // Wire up interactions
    setupInteractions();
  }

  // Setup all interactions
  function setupInteractions() {
    const hamburger = document.getElementById('navHamburger');
    const drawer = document.getElementById('navDrawer');
    const overlay = document.getElementById('navDrawerOverlay');
    const closeBtn = document.getElementById('navDrawerClose');
    const filterInput = document.getElementById('navDrawerFilter');

    // Open drawer
    function openDrawer() {
      drawer.classList.add('is-open');
      overlay.classList.add('is-visible');
      hamburger.setAttribute('aria-expanded', 'true');
      overlay.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      // Focus filter input
      setTimeout(() => filterInput.focus(), 100);
    }

    // Close drawer
    function closeDrawer() {
      drawer.classList.remove('is-open');
      overlay.classList.remove('is-visible');
      hamburger.setAttribute('aria-expanded', 'false');
      overlay.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      hamburger.focus();
    }

    // Toggle group expansion
    function toggleGroup(button) {
      const isExpanded = button.getAttribute('aria-expanded') === 'true';
      const groupItems = button.nextElementSibling;

      button.setAttribute('aria-expanded', !isExpanded);
      groupItems.classList.toggle('is-expanded');
    }

    // Event listeners
    hamburger.addEventListener('click', openDrawer);
    closeBtn.addEventListener('click', closeDrawer);
    overlay.addEventListener('click', closeDrawer);

    // Group toggles
    document.querySelectorAll('.nav-drawer-group-toggle').forEach(toggle => {
      toggle.addEventListener('click', () => toggleGroup(toggle));
    });

    // Filter input
    filterInput.addEventListener('input', (e) => {
      filterPages(e.target.value);
    });

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      // ESC to close
      if (e.key === 'Escape' && drawer.classList.contains('is-open')) {
        closeDrawer();
      }
    });

    // Trap focus in drawer when open
    drawer.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        const focusableElements = drawer.querySelectorAll(
          'button, a, input, [tabindex]:not([tabindex="-1"])'
        );
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey && document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        } else if (!e.shiftKey && document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    });
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDrawer);
  } else {
    initDrawer();
  }

})();
