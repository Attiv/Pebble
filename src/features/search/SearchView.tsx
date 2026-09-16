import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";
import { Search, SlidersHorizontal, Loader } from "lucide-react";
import type { AdvancedSearchQuery, SearchHit } from "@/lib/api";
import { advancedSearch, searchMessages } from "@/lib/api";
import { useUIStore } from "@/stores/ui.store";
import { useMailStore } from "@/stores/mail.store";
import SearchFilters from "./SearchFilters";
import SearchResultItem from "./SearchResultItem";
import MessageDetail from "@/components/MessageDetail";

const emptyFilters: AdvancedSearchQuery = {};

function hasActiveFilters(filters: AdvancedSearchQuery): boolean {
  return !!(
    filters.from ||
    filters.to ||
    filters.subject ||
    filters.dateFrom ||
    filters.dateTo ||
    filters.hasAttachment ||
    filters.folderId
  );
}

export default function SearchView() {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<AdvancedSearchQuery>(emptyFilters);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const storeSearchQuery = useUIStore((s) => s.searchQuery);
  const activeAccountId = useMailStore((s) => s.activeAccountId);

  const trimmed = query.trim();
  const filtersActive = hasActiveFilters(filters);
  const searchEnabled = hasSearched && (trimmed.length > 0 || filtersActive);

  const { data: results = [], isLoading: loading, error: queryError, refetch } = useQuery({
    // `activeAccountId` belongs in the key: switching accounts in the sidebar
    // must re-run the search against the newly selected mailbox instead of
    // serving cached hits from the previous one.
    queryKey: ["search", trimmed, filters, activeAccountId],
    queryFn: () => {
      if (filtersActive) {
        return advancedSearch({
          ...filters,
          text: trimmed || undefined,
          accountId: activeAccountId ?? undefined,
        });
      }
      return searchMessages(trimmed, undefined, activeAccountId ?? undefined);
    },
    enabled: searchEnabled,
    staleTime: 60_000,
    placeholderData: (prev: SearchHit[] | undefined) => prev,
  });

  const resultsParentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: results.length,
    getScrollElement: () => resultsParentRef.current,
    estimateSize: () => 76,
    measureElement: (el) => el.getBoundingClientRect().height,
    overscan: 5,
  });

  const doSearch = useCallback(() => {
    const t = query.trim();
    if (!t && !hasActiveFilters(filters)) {
      setHasSearched(false);
      setSelectedId(null);
      return;
    }
    setHasSearched(true);
    setSelectedId(null);
  }, [query, filters]);

  // Pick up context queries from other views and from this view while mounted.
  useEffect(() => {
    if (!storeSearchQuery) return;
    setQuery(storeSearchQuery);
    setSelectedId(null);
    setHasSearched(true);
    useUIStore.getState().setSearchQuery("");
  }, [storeSearchQuery]);

  // Auto-search when filters change
  useEffect(() => {
    if (hasActiveFilters(filters) || query.trim()) {
      doSearch();
    }
  }, [filters]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced type-ahead search (300ms after last keystroke)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (!trimmed && !hasActiveFilters(filters)) return;
    debounceRef.current = setTimeout(() => {
      doSearch();
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    doSearch();
  }

  function handleClearFilters() {
    setFilters(emptyFilters);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <form onSubmit={handleSubmit} className="search-toolbar">
        <div className="search-input-shell">
          <Search size={16} aria-hidden="true" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("inbox.searchPlaceholder")}
            aria-label={t("search.title", "Search")}
            autoFocus
            className="search-input"
          />
        </div>
        <button
          type="submit"
          className="search-toolbar-button search-toolbar-button--primary"
        >
          <Search size={14} aria-hidden="true" />
          {t("search.searchButton")}
        </button>
        <button
          type="button"
          onClick={() => setShowFilters(!showFilters)}
          title={t("search.filters")}
          aria-label={t("search.filters")}
          className={`search-toolbar-button search-toolbar-icon-button ${
            showFilters || hasActiveFilters(filters) ? "is-active" : ""
          }`}
        >
          <SlidersHorizontal size={16} />
        </button>
      </form>

      {/* Filters panel */}
      {showFilters && (
        <SearchFilters
          filters={filters}
          onChange={setFilters}
          onClear={handleClearFilters}
        />
      )}

      {/* Results + Detail split layout */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Results list */}
        <div
          ref={resultsParentRef}
          className="scroll-region search-results-scroll"
          style={{
            width: selectedId ? "clamp(260px, 32%, 360px)" : "100%",
            flexShrink: 0,
            overflow: "auto",
            borderRight: selectedId ? "1px solid var(--color-border)" : "none",
            transition: "width 0.15s ease",
          }}
        >
          {loading && (
            <div
              className="fade-in"
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: "40px",
                color: "var(--color-text-secondary)",
                fontSize: "13px",
                gap: "10px",
              }}
            >
              <Loader size={20} className="spinner" />
              <span>{t("common.loading")}</span>
            </div>
          )}

          {!loading && queryError && (
            <div
              className="fade-in"
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: "40px",
                color: "var(--color-text-secondary)",
                fontSize: "14px",
                gap: "8px",
              }}
            >
              <p style={{ color: "var(--color-error, #e53e3e)", margin: 0 }}>
                {t("search.error", "Search failed")}
              </p>
              <p style={{ fontSize: "13px", margin: 0 }}>{queryError?.message}</p>
              <button
                onClick={() => refetch()}
                style={{
                  marginTop: "8px",
                  padding: "6px 16px",
                  borderRadius: "4px",
                  border: "1px solid var(--color-border)",
                  backgroundColor: "transparent",
                  color: "var(--color-accent)",
                  fontSize: "13px",
                  cursor: "pointer",
                }}
              >
                {t("common.retry", "Retry")}
              </button>
            </div>
          )}

          {!loading && !queryError && hasSearched && results.length === 0 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: "40px",
                color: "var(--color-text-secondary)",
                fontSize: "14px",
                gap: "8px",
              }}
            >
              <Search size={28} strokeWidth={1.2} />
              {t("search.noResults")}
            </div>
          )}

          {!loading && !hasSearched && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: "60px 20px",
                color: "var(--color-text-tertiary)",
                fontSize: "14px",
                gap: "8px",
              }}
            >
              <Search size={32} />
              <span>{t("search.title")}</span>
            </div>
          )}

          {!loading && results.length > 0 && (
            <div
              role="listbox"
              aria-label={t("search.results", "Search results")}
              style={{ height: `${virtualizer.getTotalSize()}px`, width: "100%", position: "relative" }}
            >
              {virtualizer.getVirtualItems().map((virtualItem) => {
                const hit = results[virtualItem.index];
                return (
                  <div
                    key={hit.message_id}
                    ref={virtualizer.measureElement}
                    data-index={virtualItem.index}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualItem.start}px)`,
                    }}
                  >
                    <SearchResultItem
                      hit={hit}
                      isSelected={hit.message_id === selectedId}
                      onClick={() => setSelectedId(hit.message_id)}
                      query={query}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selectedId && (
          <div style={{ flex: 1, overflow: "hidden" }}>
            <MessageDetail
              messageId={selectedId}
              onBack={() => setSelectedId(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
