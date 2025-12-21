import { gameService } from './databaseService';

interface BGGSearchResult {
  objectid: string;
  name: string;
  yearpublished?: string;
}

interface BGGGameDetails {
  id: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  playingTime: number;
  minPlayTime?: number;
  maxPlayTime?: number;
  averageWeight: number;
  thumbnail?: string;
  image?: string;
  yearPublished: number;
}

class BoardGameGeekService {
  private readonly baseUrl = 'https://boardgamegeek.com/xmlapi2';

  async searchGames(query: string): Promise<BGGSearchResult[]> {
    try {
      const response = await fetch(
        `${this.baseUrl}/search?query=${encodeURIComponent(query)}&type=boardgame`
      );
      const xml = await response.text();

      // Parse XML response
      const items = this.parseSearchXML(xml);
      return items.slice(0, 10); // Limit to top 10 results
    } catch (error) {
      console.error('BGG search failed:', error);
      throw new Error('Failed to search BoardGameGeek');
    }
  }

  async getGameDetails(bggId: string): Promise<BGGGameDetails | null> {
    try {
      const response = await fetch(`${this.baseUrl}/thing?id=${bggId}&stats=1`);
      const xml = await response.text();

      return this.parseGameXML(xml);
    } catch (error) {
      console.error('BGG game details failed:', error);
      throw new Error('Failed to get game details from BoardGameGeek');
    }
  }

  async importGame(bggId: string) {
    const gameDetails = await this.getGameDetails(bggId);
    if (!gameDetails) {
      throw new Error('Game not found on BoardGameGeek');
    }

    // Check if game already exists
    const existingGames = gameService.getAll();
    const existing = existingGames.find((g) => g.bggId === parseInt(bggId));

    if (existing) {
      throw new Error('Game already exists in library');
    }

    // Create new game record
    const newGame = gameService.create({
      name: gameDetails.name,
      minPlayers: gameDetails.minPlayers,
      maxPlayers: gameDetails.maxPlayers,
      duration: gameDetails.playingTime,
      complexity: gameDetails.averageWeight,
      bggId: parseInt(bggId),
      imageUrl: gameDetails.image || gameDetails.thumbnail,
      description: this.stripHtml(gameDetails.description),
      bestWith: this.generateBestWithText(gameDetails.minPlayers, gameDetails.maxPlayers),
    });

    return newGame;
  }

  private parseSearchXML(xml: string): BGGSearchResult[] {
    const items: BGGSearchResult[] = [];
    const regex =
      /<item[^>]*id="(\d+)"[^>]*>[\s\S]*?<name[^>]*value="([^"]*)"[^>]*\/>(?:[\s\S]*?<yearpublished[^>]*value="([^"]*)"[^>]*\/>)?/g;

    let match;
    while ((match = regex.exec(xml)) !== null) {
      items.push({
        objectid: match[1],
        name: match[2],
        yearpublished: match[3] || undefined,
      });
    }

    return items;
  }

  private parseGameXML(xml: string): BGGGameDetails | null {
    try {
      // Extract basic game info
      const idMatch = xml.match(/<item[^>]*id="(\d+)"/);
      const nameMatch = xml.match(/<name[^>]*type="primary"[^>]*value="([^"]*)"/);
      const descriptionMatch = xml.match(/<description>(.*?)<\/description>/s);
      const yearMatch = xml.match(/<yearpublished[^>]*value="(\d+)"/);

      // Extract player counts
      const minPlayersMatch = xml.match(/<minplayers[^>]*value="(\d+)"/);
      const maxPlayersMatch = xml.match(/<maxplayers[^>]*value="(\d+)"/);

      // Extract playing time
      const playingTimeMatch = xml.match(/<playingtime[^>]*value="(\d+)"/);
      const minPlayTimeMatch = xml.match(/<minplaytime[^>]*value="(\d+)"/);
      const maxPlayTimeMatch = xml.match(/<maxplaytime[^>]*value="(\d+)"/);

      // Extract complexity (average weight)
      const weightMatch = xml.match(/<averageweight[^>]*value="([^"]*)"/);

      // Extract images
      const thumbnailMatch = xml.match(/<thumbnail>(.*?)<\/thumbnail>/);
      const imageMatch = xml.match(/<image>(.*?)<\/image>/);

      if (!idMatch || !nameMatch) {
        return null;
      }

      return {
        id: idMatch[1],
        name: nameMatch[1],
        description: descriptionMatch ? descriptionMatch[1] : '',
        minPlayers: minPlayersMatch ? parseInt(minPlayersMatch[1]) : 1,
        maxPlayers: maxPlayersMatch ? parseInt(maxPlayersMatch[1]) : 1,
        playingTime: playingTimeMatch ? parseInt(playingTimeMatch[1]) : 0,
        minPlayTime: minPlayTimeMatch ? parseInt(minPlayTimeMatch[1]) : undefined,
        maxPlayTime: maxPlayTimeMatch ? parseInt(maxPlayTimeMatch[1]) : undefined,
        averageWeight: weightMatch ? parseFloat(weightMatch[1]) : 0,
        thumbnail: thumbnailMatch ? thumbnailMatch[1] : undefined,
        image: imageMatch ? imageMatch[1] : undefined,
        yearPublished: yearMatch ? parseInt(yearMatch[1]) : 0,
      };
    } catch (error) {
      console.error('Error parsing BGG XML:', error);
      return null;
    }
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#10;/g, '\n')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private generateBestWithText(minPlayers: number, maxPlayers: number): string {
    if (minPlayers === maxPlayers) {
      return `${minPlayers} players`;
    }

    // Simple heuristic: best with is usually around the middle to upper range
    if (maxPlayers - minPlayers === 1) {
      return `${maxPlayers} players`;
    } else if (maxPlayers - minPlayers === 2) {
      return `${minPlayers + 1}-${maxPlayers} players`;
    } else {
      const bestMin = Math.ceil((minPlayers + maxPlayers) / 2);
      return `${bestMin}-${maxPlayers} players`;
    }
  }
}

export const bggService = new BoardGameGeekService();
