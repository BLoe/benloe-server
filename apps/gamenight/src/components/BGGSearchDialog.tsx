import { useState, Fragment, useEffect } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon, MagnifyingGlassIcon, PlusIcon } from '@heroicons/react/24/outline';
import { useGameStore } from '../store/gameStore';
import clsx from 'clsx';

interface BGGSearchDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function BGGSearchDialog({ isOpen, onClose }: BGGSearchDialogProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [importingIds, setImportingIds] = useState<Set<string>>(new Set());

  const { bggSearchResults, bggLoading, bggError, searchBGG, importFromBGG, clearBGGResults } =
    useGameStore();

  // Clear results when dialog closes
  useEffect(() => {
    if (!isOpen) {
      clearBGGResults();
      setSearchTerm('');
      setImportingIds(new Set());
    }
  }, [isOpen, clearBGGResults]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (searchTerm.trim()) {
      await searchBGG(searchTerm.trim());
    }
  };

  const handleImport = async (bggId: string, gameName: string) => {
    setImportingIds((prev) => new Set([...prev, bggId]));
    try {
      await importFromBGG(bggId);
      // Show success message or close dialog
      alert(`Successfully imported "${gameName}" to your game library!`);
    } catch (error) {
      console.error('Import failed:', error);
      // Error is already handled by the store
    } finally {
      setImportingIds((prev) => {
        const newSet = new Set(prev);
        newSet.delete(bggId);
        return newSet;
      });
    }
  };

  const handleClose = () => {
    if (!bggLoading && importingIds.size === 0) {
      onClose();
    }
  };

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={handleClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black bg-opacity-25" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-2xl transform overflow-hidden rounded-2xl bg-white p-6 text-left align-middle shadow-xl transition-all">
                <div className="flex items-center justify-between mb-6">
                  <Dialog.Title as="h3" className="text-lg font-medium leading-6 text-gray-900">
                    Import from BoardGameGeek
                  </Dialog.Title>
                  <button
                    type="button"
                    className="rounded-md text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    onClick={handleClose}
                    disabled={bggLoading || importingIds.size > 0}
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>

                {/* Search Form */}
                <form onSubmit={handleSearch} className="mb-6">
                  <div className="relative">
                    <MagnifyingGlassIcon className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Search for games on BoardGameGeek..."
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                      disabled={bggLoading}
                    />
                    <button
                      type="submit"
                      disabled={bggLoading || !searchTerm.trim()}
                      className="absolute right-2 top-1.5 px-3 py-1 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {bggLoading ? 'Searching...' : 'Search'}
                    </button>
                  </div>
                </form>

                {/* Error Display */}
                {bggError && (
                  <div className="mb-4 rounded-md bg-red-50 p-4">
                    <div className="text-sm text-red-700">{bggError}</div>
                  </div>
                )}

                {/* Search Results */}
                <div className="max-h-96 overflow-y-auto">
                  {bggLoading && (
                    <div className="flex justify-center py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                    </div>
                  )}

                  {!bggLoading && bggSearchResults.length === 0 && searchTerm && (
                    <div className="text-center py-8">
                      <p className="text-gray-500">No games found matching "{searchTerm}"</p>
                      <p className="text-gray-400 text-sm mt-1">Try a different search term</p>
                    </div>
                  )}

                  {bggSearchResults.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-sm font-medium text-gray-700 mb-3">
                        Found {bggSearchResults.length} games:
                      </h4>
                      {bggSearchResults.map((game) => (
                        <div
                          key={game.objectid}
                          className="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50"
                        >
                          <div className="flex-1 min-w-0">
                            <h5 className="text-sm font-medium text-gray-900 truncate">
                              {game.name}
                            </h5>
                            {game.yearpublished && (
                              <p className="text-xs text-gray-500">
                                Published: {game.yearpublished}
                              </p>
                            )}
                          </div>
                          <button
                            onClick={() => handleImport(game.objectid, game.name)}
                            disabled={importingIds.has(game.objectid)}
                            className={clsx(
                              'ml-3 inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500',
                              importingIds.has(game.objectid)
                                ? 'text-gray-400 bg-gray-100 cursor-not-allowed'
                                : 'text-indigo-700 bg-indigo-100 hover:bg-indigo-200'
                            )}
                          >
                            {importingIds.has(game.objectid) ? (
                              <>
                                <div className="animate-spin rounded-full h-3 w-3 border-b border-indigo-600 mr-1"></div>
                                Importing...
                              </>
                            ) : (
                              <>
                                <PlusIcon className="h-3 w-3 mr-1" />
                                Import
                              </>
                            )}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Instructions */}
                {!searchTerm && (
                  <div className="mt-4 p-4 bg-blue-50 rounded-lg">
                    <p className="text-sm text-blue-700">
                      Search for board games on BoardGameGeek and import them directly to your
                      library. Game details including player count, complexity, and images will be
                      automatically imported.
                    </p>
                  </div>
                )}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
