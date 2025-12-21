import xml2js from 'xml2js';

interface BGGSearchResult {
  id: number;
  name: string;
  type: string;
  yearPublished?: number;
}

interface BGGGameDetails {
  id: number;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  playingTime: number;
  minPlayingTime?: number;
  maxPlayingTime?: number;
  complexity: number;
  imageUrl?: string;
  thumbnailUrl?: string;
  yearPublished?: number;
  categories: string[];
  mechanics: string[];
  designers: string[];
  publishers: string[];
  averageRating: number;
  bayesianRating: number;
  numRatings: number;
}

class BGGService {
  private static readonly BASE_URL = 'https://boardgamegeek.com/xmlapi2';
  private static readonly RATE_LIMIT_DELAY = 2000; // BGG requests 2 second delay
  private lastRequestTime = 0;
  private parser = new xml2js.Parser({ explicitArray: false });

  private async delay() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < BGGService.RATE_LIMIT_DELAY) {
      const delay = BGGService.RATE_LIMIT_DELAY - timeSinceLastRequest;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    this.lastRequestTime = Date.now();
  }

  private async fetchXML(url: string): Promise<any> {
    await this.delay();

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'GameNightScheduler/1.0 (contact: admin@benloe.com)',
      },
    });

    if (!response.ok) {
      throw new Error(`BGG API error: ${response.status} ${response.statusText}`);
    }

    const xmlText = await response.text();
    return this.parser.parseStringPromise(xmlText);
  }

  private getValue(obj: any, path: string, defaultValue: any = ''): any {
    return path.split('.').reduce((current, key) => {
      return current && current[key] !== undefined ? current[key] : defaultValue;
    }, obj);
  }

  private getAttr(obj: any, attr: string, defaultValue: any = ''): any {
    return obj && obj.$ && obj.$[attr] !== undefined ? obj.$[attr] : defaultValue;
  }

  async searchGames(query: string, exactMatch = false): Promise<BGGSearchResult[]> {
    try {
      const searchType = exactMatch ? 'exact=1' : '';
      const url = `${BGGService.BASE_URL}/search?query=${encodeURIComponent(query)}&type=boardgame&${searchType}`;

      const data = await this.fetchXML(url);
      const items = data.items?.item || [];
      const itemArray = Array.isArray(items) ? items : [items];

      const results: BGGSearchResult[] = [];

      for (const item of itemArray) {
        if (!item || !item.$) continue;

        const id = parseInt(this.getAttr(item, 'id'));
        const name = this.getAttr(item.name, 'value');
        const type = this.getAttr(item, 'type');
        const yearPublished = item.yearpublished
          ? parseInt(this.getAttr(item.yearpublished, 'value'))
          : undefined;

        if (id && name) {
          results.push({
            id,
            name,
            type,
            yearPublished: yearPublished || undefined,
          });
        }
      }

      return results;
    } catch (error) {
      console.error('Error searching BGG:', error);
      throw new Error('Failed to search BoardGameGeek');
    }
  }

  async getGameDetails(gameId: number): Promise<BGGGameDetails | null> {
    try {
      const url = `${BGGService.BASE_URL}/thing?id=${gameId}&stats=1`;

      const data = await this.fetchXML(url);
      const items = data.items?.item || [];
      const item = Array.isArray(items) ? items[0] : items;

      if (!item) {
        return null;
      }

      // Extract basic information
      const names = Array.isArray(item.name) ? item.name : [item.name];
      const primaryName =
        names.find(
          (n: { $: { type: string; value: string } }) => this.getAttr(n, 'type') === 'primary'
        )?.$.value ||
        names[0]?.$.value ||
        '';

      const description = item.description || '';
      const minPlayers = parseInt(this.getAttr(item.minplayers, 'value')) || 1;
      const maxPlayers = parseInt(this.getAttr(item.maxplayers, 'value')) || 1;
      const playingTime = parseInt(this.getAttr(item.playingtime, 'value')) || 0;
      const minPlayingTime = parseInt(this.getAttr(item.minplaytime, 'value')) || 0;
      const maxPlayingTime = parseInt(this.getAttr(item.maxplaytime, 'value')) || 0;

      const yearPublished = parseInt(this.getAttr(item.yearpublished, 'value')) || undefined;

      // Extract images
      const imageUrl = item.image || '';
      const thumbnailUrl = item.thumbnail || '';

      // Extract complexity (weight) and ratings
      const stats = item.statistics?.ratings;
      const complexity = parseFloat(this.getAttr(stats?.averageweight, 'value')) || 0;
      const averageRating = parseFloat(this.getAttr(stats?.average, 'value')) || 0;
      const bayesianRating = parseFloat(this.getAttr(stats?.bayesaverage, 'value')) || 0;
      const numRatings = parseInt(this.getAttr(stats?.usersrated, 'value')) || 0;

      // Helper function to extract link values
      const extractLinks = (type: string): string[] => {
        const links = Array.isArray(item.link) ? item.link : [item.link];
        return links
          .filter(
            (link: { $: { type: string; value: string } }) => this.getAttr(link, 'type') === type
          )
          .map((link: { $: { type: string; value: string } }) => this.getAttr(link, 'value'))
          .filter(Boolean);
      };

      const categories = extractLinks('boardgamecategory');
      const mechanics = extractLinks('boardgamemechanic');
      const designers = extractLinks('boardgamedesigner');
      const publishers = extractLinks('boardgamepublisher');

      return {
        id: gameId,
        name: primaryName,
        description,
        minPlayers,
        maxPlayers,
        playingTime,
        minPlayingTime: minPlayingTime || undefined,
        maxPlayingTime: maxPlayingTime || undefined,
        complexity,
        imageUrl: imageUrl || undefined,
        thumbnailUrl: thumbnailUrl || undefined,
        yearPublished,
        categories,
        mechanics,
        designers,
        publishers,
        averageRating,
        bayesianRating,
        numRatings,
      };
    } catch (error) {
      console.error('Error getting BGG game details:', error);
      throw new Error('Failed to get game details from BoardGameGeek');
    }
  }

  async importGameFromBGG(gameId: number) {
    const details = await this.getGameDetails(gameId);
    if (!details) {
      throw new Error('Game not found on BoardGameGeek');
    }

    // Convert BGG data to our game format
    return {
      name: details.name,
      minPlayers: details.minPlayers,
      maxPlayers: details.maxPlayers,
      duration: details.playingTime > 0 ? details.playingTime : undefined,
      complexity: details.complexity > 0 ? details.complexity : undefined,
      bggId: details.id,
      imageUrl: details.imageUrl,
      description:
        details.description.length > 500
          ? details.description.substring(0, 500) + '...'
          : details.description,
      bestWith: this.generateBestWithRecommendation(details.minPlayers, details.maxPlayers),
    };
  }

  private generateBestWithRecommendation(minPlayers: number, maxPlayers: number): string {
    if (minPlayers === maxPlayers) {
      return `${minPlayers} players`;
    }

    // Simple heuristic for "best with" - favors middle range
    if (maxPlayers - minPlayers <= 1) {
      return `${minPlayers}-${maxPlayers} players`;
    }

    const middle = Math.floor((minPlayers + maxPlayers) / 2);
    if (middle === minPlayers + 1) {
      return `${minPlayers}-${middle} players`;
    }

    return `${middle} players`;
  }
}

export const bggService = new BGGService();
export type { BGGSearchResult, BGGGameDetails };
