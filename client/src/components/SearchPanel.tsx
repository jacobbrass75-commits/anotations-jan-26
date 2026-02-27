import { useState } from "react";
import { Search, ChevronUp, ChevronDown, MapPin, Sparkles } from "lucide-react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { SearchResult } from "@shared/schema";

interface SearchPanelProps {
  documentId: string | null;
  onSearch: (query: string) => Promise<SearchResult[]>;
  onJumpToPosition: (start: number, end: number) => void;
}

const relevanceColors = {
  high: "bg-eva-green/15 text-eva-green border border-eva-green/30",
  medium: "bg-eva-orange/15 text-eva-orange border border-eva-orange/30",
  low: "bg-muted text-muted-foreground border-muted",
};

export function SearchPanel({ documentId, onSearch, onJumpToPosition }: SearchPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showAllResults, setShowAllResults] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || !documentId) return;

    setIsSearching(true);
    try {
      const searchResults = await onSearch(query);
      setResults(searchResults);
      setShowAllResults(false);
    } catch (error) {
      console.error("Search failed:", error);
    } finally {
      setIsSearching(false);
    }
  };

  const displayedResults = showAllResults ? results : results.slice(0, 5);
  const hasMoreResults = results.length > 5;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className="border-t-2 border-t-primary/20 eva-corner-decor bg-card">
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer flex flex-row items-center justify-between gap-4 py-3 hover:bg-muted/50 transition-colors">
            <div className="flex items-center gap-2">
              <Search className="h-5 w-5 text-primary" />
              <h2 className="eva-section-title text-sm">SEMANTIC SEARCH // MAGI</h2>
              {results.length > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {results.length} results
                </Badge>
              )}
            </div>
            {isOpen ? (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronUp className="h-5 w-5 text-muted-foreground" />
            )}
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="pt-0 pb-4">
            <form onSubmit={handleSearch} className="flex gap-2 mb-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="ENTER SEARCH QUERY..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-9 font-mono bg-eva-dark/50 text-eva-green eva-focus-glow border-eva-orange/30"
                  disabled={!documentId || isSearching}
                  data-testid="input-search"
                />
                {isSearching && (
                  <div
                    className="absolute right-3 top-1/2 -translate-y-1/2 eva-hex-spinner"
                    style={{ width: "1rem", height: "1rem" }}
                  />
                )}
              </div>
              <Button type="submit" disabled={!documentId || !query.trim() || isSearching} data-testid="button-search">
                <Sparkles className="h-4 w-4 mr-2 text-eva-orange eva-glitch" />
                Search
              </Button>
            </form>

            <div className="space-y-2 text-xs text-muted-foreground mb-4">
              <p>Try queries like:</p>
              <div className="flex flex-wrap gap-2">
                {[
                  "Find quotes about...",
                  "What are the main arguments?",
                  "Summarize the methodology",
                  "Find evidence for...",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="px-2 py-1 font-mono text-xs uppercase tracking-wider bg-secondary rounded-md hover:bg-eva-orange/10 hover:text-eva-orange transition-colors"
                    onClick={() => setQuery(suggestion)}
                    disabled={!documentId}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>

            {results.length > 0 && (
              <ScrollArea className="max-h-[300px]">
                <div className="space-y-3">
                  {displayedResults.map((result, index) => (
                    <Card
                      key={index}
                      className="p-4 hover-elevate cursor-pointer eva-clip-sm"
                      onClick={() => onJumpToPosition(result.startPosition, result.endPosition)}
                      data-testid={`search-result-${index}`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <Badge
                          variant="outline"
                          className={`text-xs ${relevanceColors[result.relevance]}`}
                        >
                          {result.relevance} relevance
                        </Badge>
                        <button className="text-eva-cyan hover:text-eva-cyan/80 flex items-center gap-1 uppercase text-xs tracking-wider">
                          <MapPin className="h-3 w-3" />
                          Jump to
                        </button>
                      </div>

                      <p className="text-sm font-mono text-muted-foreground line-clamp-3 mb-2 border-l-2 pl-3 border-muted">
                        "{result.quote}"
                      </p>

                      <p className="text-sm text-foreground">{result.explanation}</p>
                    </Card>
                  ))}
                </div>

                {hasMoreResults && (
                  <Button
                    variant="ghost"
                    className="w-full mt-3"
                    onClick={() => setShowAllResults(!showAllResults)}
                  >
                    {showAllResults ? "Show less" : `Show ${results.length - 5} more`}
                  </Button>
                )}
              </ScrollArea>
            )}

            {results.length === 0 && query && !isSearching && (
              <div className="text-center py-6">
                <Search className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-50" />
                <p className="text-sm text-muted-foreground">
                  No results found for your query
                </p>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
