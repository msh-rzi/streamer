import StreamPlayer from '@/components/player';

const App = () => {
  return (
    <div className="min-h-screen min-w-screen flex items-center justify-center bg-gray-900 p-6">
      <StreamPlayer className="max-w-4xl" />
    </div>
  );
};

export default App;
