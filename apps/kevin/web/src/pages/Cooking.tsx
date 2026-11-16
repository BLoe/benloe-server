import { ChevronDown, Link2, PencilLine, Plus, Sparkles, UtensilsCrossed } from 'lucide-react';
import { useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { ErrorState, LoadingRows, Page, PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { openChat } from '@/lib/chat';
import { localDay } from '@/lib/format';
import { useView } from '@/lib/useView';
import { CookLog, Recipes, SkillsTab, TEACH_ME, Tonight } from './cooking/lists';
import type { CookingOverview, LogEntry } from './cooking/logic';
import { MealSheet } from './cooking/MealSheet';
import { usePantryRefresh } from './cooking/parts';
import { RecipeDetail } from './cooking/RecipeDetail';
import { RecipeForm } from './cooking/RecipeForm';

const TABS = ['tonight', 'recipes', 'log', 'skills'] as const;
type Tab = (typeof TABS)[number];

/**
 * /cooking — Tonight, Recipes, Log, Skills from one call to cooking/overview.
 * /cooking?recipe=12 is that recipe; &cook=1 is cooking mode over it. Both are
 * history entries, so the phone's Back leaves cooking mode, then the recipe.
 */
export default function CookingPage() {
  const view = useView<CookingOverview>('cooking/overview');
  usePantryRefresh(view.refetch);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const tab: Tab = TABS.find((t) => t === params.get('tab')) ?? 'tonight';
  const recipeId = /^\d+$/.test(params.get('recipe') ?? '') ? Number(params.get('recipe')) : null;
  const cooking = params.get('cook') === '1';
  const [form, setForm] = useState(false);
  const [logging, setLogging] = useState(false);
  const [entry, setEntry] = useState<LogEntry | null>(null);

  const withParams = (patch: Record<string, string | null>): URLSearchParams => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    return next;
  };
  // Steps taken inside the page are pushed with a marker, so closing them is a real Back when it can be.
  const pushed = (location.state as { cookingStep?: boolean } | null)?.cookingStep === true;
  const openRecipe = (id: number) => setParams(withParams({ recipe: String(id), cook: null }), { state: { cookingStep: true } });
  const closeRecipe = () => (pushed && !cooking ? void navigate(-1) : setParams(withParams({ recipe: null, cook: null }), { replace: true }));
  const setCooking = (open: boolean) => {
    if (open) setParams(withParams({ cook: '1' }), { state: { cookingStep: true } });
    else if (pushed) void navigate(-1);
    else setParams(withParams({ cook: null }), { replace: true });
  };

  const today = view.data?.today ?? localDay();

  if (recipeId != null) {
    return (
      <Page className="gap-5">
        <RecipeDetail key={recipeId} id={recipeId} today={today} cooking={cooking} onBack={closeRecipe} onCook={setCooking} onGone={() => setParams(withParams({ recipe: null, cook: null }), { replace: true })} />
      </Page>
    );
  }

  const data = view.data;
  return (
    <Page className="gap-5">
      <PageHeader
        title="Cooking"
        description="What to make, your recipes, and what you’ve cooked."
        actions={
          <>
            <Button variant="outline" onClick={() => setLogging(true)}>
              <UtensilsCrossed />
              Log a meal
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <Plus />
                  Save a recipe
                  <ChevronDown className="-mr-1 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => openChat({ prefill: 'Save this recipe: ', newThread: true })}>
                  <Link2 />
                  Paste a link or text for Kevin
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setForm(true)}>
                  <PencilLine />
                  Write it in myself
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <div className="flex flex-col gap-2 @md/page:flex-row">
        <Button size="lg" className="h-14 text-base @md/page:flex-[3] lg:h-12 lg:text-[15px]" onClick={() => openChat({ send: 'What can I make tonight?', newThread: true })}>
          What can I make tonight?
        </Button>
        <Button size="lg" variant="outline" className="@md/page:flex-[2] lg:h-12" onClick={() => openChat({ send: TEACH_ME, newThread: true })}>
          <Sparkles />
          Teach me something new
        </Button>
      </div>

      {!data ? (
        view.error ? (
          <ErrorState message={view.error} onRetry={view.refetch} />
        ) : (
          <LoadingRows rows={5} />
        )
      ) : (
        <Tabs value={tab} onValueChange={(t) => setParams(t === 'tonight' ? {} : { tab: t }, { replace: true })} className="gap-4">
          <TabsList>
            <TabsTrigger value="tonight">Tonight</TabsTrigger>
            <TabsTrigger value="recipes">
              Recipes
              {data.recipes.length > 0 && <span className="tabular ml-1.5 rounded-full bg-secondary px-1.5 py-px text-xs text-muted-foreground">{data.recipes.length}</span>}
            </TabsTrigger>
            <TabsTrigger value="log">Log</TabsTrigger>
            <TabsTrigger value="skills">Skills</TabsTrigger>
          </TabsList>
          <TabsContent value="tonight">
            <Tonight data={data} onOpen={openRecipe} onNew={() => setForm(true)} />
          </TabsContent>
          <TabsContent value="recipes">
            <Recipes data={data} onOpen={openRecipe} onNew={() => setForm(true)} />
          </TabsContent>
          <TabsContent value="log">
            <CookLog data={data} onOpen={openRecipe} onEdit={setEntry} onLog={() => setLogging(true)} />
          </TabsContent>
          <TabsContent value="skills">
            <SkillsTab data={data} onOpen={openRecipe} />
          </TabsContent>
        </Tabs>
      )}

      {form && <RecipeForm recipe={null} onClose={() => setForm(false)} onSaved={openRecipe} />}
      {logging && <MealSheet today={today} onClose={() => setLogging(false)} />}
      {entry && <MealSheet key={entry.id} entry={entry} today={today} onClose={() => setEntry(null)} />}
    </Page>
  );
}
