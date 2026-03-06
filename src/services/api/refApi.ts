import { AnyFolder, folderManagerApi } from './folderApi';

export type ReferenceTab = 'wrong' | 'note' | 'qbank';
export type SetCurrentFolderId = (id: string | undefined) => void;

interface TabSwitchActions {
  setTab: (tab: ReferenceTab) => void;
  setSearchTerm: (value: string) => void;
  setWrongCurrentFolderId: SetCurrentFolderId;
  setNoteCurrentFolderId: SetCurrentFolderId;
  setQbankCurrentFolderId: SetCurrentFolderId;
}

export interface FolderInteractionRow {
  id: string;
  name: string;
  itemCount: number;
  subFolderCount: number;
}

export interface FolderInteractionData {
  childFolders: AnyFolder[];
  breadcrumbFolders: AnyFolder[];
  folderRows: FolderInteractionRow[];
  showRootRow: boolean;
}

export const referenceSelectorApi = {
  switchTab(nextTab: ReferenceTab, actions: TabSwitchActions): void {
    const {
      setTab,
      setSearchTerm,
      setWrongCurrentFolderId,
      setNoteCurrentFolderId,
      setQbankCurrentFolderId,
    } = actions;

    setTab(nextTab);
    setSearchTerm('');

    if (nextTab === 'wrong') {
      setWrongCurrentFolderId(undefined);
      return;
    }
    if (nextTab === 'note') {
      setNoteCurrentFolderId(undefined);
      return;
    }
    setQbankCurrentFolderId(undefined);
  },

  openFolder(folderId: string, setCurrentFolderId: SetCurrentFolderId): void {
    setCurrentFolderId(folderId);
  },

  goToRoot(setCurrentFolderId: SetCurrentFolderId): void {
    setCurrentFolderId(undefined);
  },

  getFolderInteractionData(
    allFolders: AnyFolder[],
    currentFolderId: string | undefined,
    countFn: (folderId: string) => number,
  ): FolderInteractionData {
    const childFolders = folderManagerApi.getChildFolders(allFolders, currentFolderId);
    const breadcrumbFolders = currentFolderId ? folderManagerApi.getFolderPath(allFolders, currentFolderId) : [];
    const folderRows = childFolders.map(folder => ({
      id: folder.id,
      name: folder.name,
      itemCount: countFn(folder.id),
      subFolderCount: folderManagerApi.getChildFolders(allFolders, folder.id).length,
    }));

    return {
      childFolders,
      breadcrumbFolders,
      folderRows,
      showRootRow: !currentFolderId,
    };
  },
};
