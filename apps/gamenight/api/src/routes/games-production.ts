import { Router } from 'express';
import { gameService } from '../services/databaseService';
import { bggService } from '../services/boardgamegeek';
import { authenticate } from '../middleware/auth';

const router = Router();

// GET /api/games - List all games with optional filtering
router.get('/', (req, res) => {
  try {
    const games = gameService.getAll();

    // Apply client-side filtering if needed
    let filteredGames = games;

    const query = req.query.query as string;
    const playerCount = req.query.playerCount ? parseInt(req.query.playerCount as string) : null;
    const complexity = req.query.complexity ? parseFloat(req.query.complexity as string) : null;

    if (query) {
      filteredGames = filteredGames.filter((game) =>
        game.name.toLowerCase().includes(query.toLowerCase())
      );
    }

    if (playerCount) {
      filteredGames = filteredGames.filter(
        (game) => playerCount >= game.minPlayers && playerCount <= game.maxPlayers
      );
    }

    if (complexity) {
      filteredGames = filteredGames.filter(
        (game) => game.complexity && Math.abs(game.complexity - complexity) <= 0.5
      );
    }

    res.json({ games: filteredGames });
  } catch (error) {
    console.error('Error fetching games:', error);
    res.status(500).json({ error: 'Failed to fetch games' });
  }
});

// GET /api/games/:id - Get single game
router.get('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const game = gameService.getById(id);

    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    res.json({ game });
  } catch (error) {
    console.error('Error fetching game:', error);
    res.status(500).json({ error: 'Failed to fetch game' });
  }
});

// POST /api/games - Create new game (requires auth)
router.post('/', authenticate, (req, res) => {
  try {
    const {
      name,
      minPlayers,
      maxPlayers,
      duration,
      complexity,
      bggId,
      imageUrl,
      description,
      bestWith,
    } = req.body;

    if (!name || !minPlayers || !maxPlayers) {
      return res.status(400).json({ error: 'Name, minPlayers, and maxPlayers are required' });
    }

    if (minPlayers > maxPlayers) {
      return res
        .status(400)
        .json({ error: 'maxPlayers must be greater than or equal to minPlayers' });
    }

    const game = gameService.create({
      name,
      minPlayers,
      maxPlayers,
      duration,
      complexity,
      bggId,
      imageUrl,
      description,
      bestWith,
    });

    res.status(201).json({ game });
  } catch (error) {
    console.error('Error creating game:', error);
    if (error instanceof Error && error.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Game with this BGG ID already exists' });
    }
    res.status(500).json({ error: 'Failed to create game' });
  }
});

// PUT /api/games/:id - Update game (requires auth)
router.put('/:id', authenticate, (req, res) => {
  try {
    const { id } = req.params;
    const existing = gameService.getById(id);

    if (!existing) {
      return res.status(404).json({ error: 'Game not found' });
    }

    const {
      name,
      minPlayers,
      maxPlayers,
      duration,
      complexity,
      bggId,
      imageUrl,
      description,
      bestWith,
    } = req.body;

    const updateData: Record<string, string | number | null | undefined> = {};
    if (name !== undefined) updateData.name = name;
    if (minPlayers !== undefined) updateData.minPlayers = minPlayers;
    if (maxPlayers !== undefined) updateData.maxPlayers = maxPlayers;
    if (duration !== undefined) updateData.duration = duration;
    if (complexity !== undefined) updateData.complexity = complexity;
    if (bggId !== undefined) updateData.bggId = bggId;
    if (imageUrl !== undefined) updateData.imageUrl = imageUrl;
    if (description !== undefined) updateData.description = description;
    if (bestWith !== undefined) updateData.bestWith = bestWith;

    if (
      updateData.minPlayers &&
      updateData.maxPlayers &&
      updateData.minPlayers > updateData.maxPlayers
    ) {
      return res
        .status(400)
        .json({ error: 'maxPlayers must be greater than or equal to minPlayers' });
    }

    const game = gameService.update(id, updateData);
    res.json({ game });
  } catch (error) {
    console.error('Error updating game:', error);
    if (error instanceof Error && error.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Game with this BGG ID already exists' });
    }
    res.status(500).json({ error: 'Failed to update game' });
  }
});

// DELETE /api/games/:id - Delete game (requires auth)
router.delete('/:id', authenticate, (req, res) => {
  try {
    const { id } = req.params;
    const game = gameService.getById(id);

    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    const deleted = gameService.delete(id);

    if (deleted) {
      res.json({ message: 'Game deleted successfully' });
    } else {
      res.status(500).json({ error: 'Failed to delete game' });
    }
  } catch (error) {
    console.error('Error deleting game:', error);
    if (error instanceof Error && error.message.includes('FOREIGN KEY')) {
      return res.status(409).json({ error: 'Cannot delete game with existing events' });
    }
    res.status(500).json({ error: 'Failed to delete game' });
  }
});

// GET /api/games/bgg/search - Search BoardGameGeek (requires auth)
router.get('/bgg/search', authenticate, async (req, res) => {
  try {
    const { query } = req.query;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Query parameter is required' });
    }

    const results = await bggService.searchGames(query);
    res.json({ results });
  } catch (error) {
    console.error('Error searching BGG:', error);
    res.status(500).json({ error: 'Failed to search BoardGameGeek' });
  }
});

// GET /api/games/bgg/:id - Get BGG game details (requires auth)
router.get('/bgg/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || !/^\d+$/.test(id)) {
      return res.status(400).json({ error: 'Valid BGG ID is required' });
    }

    const gameDetails = await bggService.getGameDetails(id);

    if (!gameDetails) {
      return res.status(404).json({ error: 'Game not found on BoardGameGeek' });
    }

    res.json({ game: gameDetails });
  } catch (error) {
    console.error('Error getting BGG game details:', error);
    res.status(500).json({ error: 'Failed to get game details from BoardGameGeek' });
  }
});

// POST /api/games/bgg/:id/import - Import game from BGG (requires auth)
router.post('/bgg/:id/import', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || !/^\d+$/.test(id)) {
      return res.status(400).json({ error: 'Valid BGG ID is required' });
    }

    const game = await bggService.importGame(id);
    res.status(201).json({ game, message: 'Game imported successfully' });
  } catch (error) {
    console.error('Error importing game from BGG:', error);
    if (error instanceof Error) {
      if (error.message.includes('already exists')) {
        return res.status(409).json({ error: error.message });
      }
      if (error.message.includes('not found')) {
        return res.status(404).json({ error: error.message });
      }
    }
    res.status(500).json({ error: 'Failed to import game from BoardGameGeek' });
  }
});

export { router as gameRoutes };
