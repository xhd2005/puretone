import { createRouter, createWebHashHistory } from 'vue-router';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      redirect: '/home',
    },
    {
      path: '/home',
      name: 'home',
      component: () => import('@/views/HomeView.vue'),
      meta: { tab: 'home', title: '主页' },
    },
    {
      path: '/library',
      name: 'library',
      component: () => import('@/views/LibraryView.vue'),
      meta: { tab: 'library', title: '资料库' },
    },
    {
      path: '/search',
      name: 'search',
      component: () => import('@/views/SearchView.vue'),
      meta: { tab: 'search', title: '搜索' },
    },
    {
      path: '/playlist/:id',
      name: 'playlist',
      component: () => import('@/views/PlaylistDetailView.vue'),
      meta: { tab: 'library', title: '歌单' },
    },
    {
      path: '/daily',
      name: 'daily',
      component: () => import('@/views/DailyRecommendView.vue'),
      meta: { tab: 'home', title: '每日推荐' },
    },
    {
      path: '/recent',
      name: 'recent',
      component: () => import('@/views/RecentPlaysView.vue'),
      meta: { tab: 'library', title: '最近播放' },
    },
  ],
});

export default router;
